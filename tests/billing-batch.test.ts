import { existsSync, readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type Role } from "@prisma/client";
import { toast } from "sonner";
import { POST as createPayment } from "@/app/api/payments/create/route";
import { POST as remind } from "@/app/api/payments/[id]/remind/route";
import { POST as sendInvoiceRoute } from "@/app/api/invoices/[id]/send/route";
import { POST as addItemRoute } from "@/app/api/service-jobs/[id]/items/route";
import { POST as addType } from "@/app/api/service-types/route";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { db } from "@/lib/db";
import { CLIPS, EVEN_OVERLAY, SIDE_OVERLAY } from "@/lib/media-clips";
import { generateInvoice } from "@/lib/services/invoices";
import { billPrices } from "@/lib/services/service-rates";
import { call, fake, loginCookie, makeJob, makeUser, sendieeCalls } from "./helpers";

const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; email: string; phone: string | null; role: Role } }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/admin/billing",
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
vi.mock("@/lib/auth/page", () => ({
  currentUser: async () => session.user,
  requireRole: async (roles: Role[]) => {
    if (!session.user || !roles.includes(session.user.role)) throw new Error("REFUSED");
    return session.user;
  },
}));

const { default: AdminBilling } = await import("@/app/admin/billing/page");
const { default: ReceptionBilling } = await import("@/app/reception/billing/page");
const { default: OldPayments } = await import("@/app/admin/payments/page");
const { default: OldInvoices } = await import("@/app/admin/invoices/page");
const { default: OldReceptionPayments } = await import("@/app/reception/payments/page");
const { default: ServiceTypesPage } = await import("@/app/admin/service-types/page");
const { default: CustomersJobsPage } = await import("@/app/admin/customers-jobs/page");
const { RatesView } = await import("@/components/rates-view");
const { pickTab } = await import("@/components/data-board");
const { default: JobPage } = await import("@/app/admin/jobs/[id]/page");
const { ActionButton, CopyButton, FormDialog, filledValue, formValues, showResult } = await import("@/components/actions");
const { JobBoard } = await import("@/components/job-board");
const { DataBoard } = await import("@/components/data-board-client");
const { Shell, navActive } = await import("@/components/shell");

async function html(element: ReactElement) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
}

function elements(node: unknown, found: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => elements(n, found));
  else if (isValidElement(node)) {
    found.push(node as ReactElement<Record<string, unknown>>);
    Object.values(node.props as object).forEach((v) => elements(v, found));
  } else if (node && typeof node === "object" && Object.getPrototypeOf(node) === Object.prototype) Object.values(node).forEach((v) => elements(v, found));
  return found;
}

function assertSendable(value: unknown, where: string) {
  if (isValidElement(value)) return;
  if (typeof value === "function" || value instanceof Date || Prisma.Decimal.isDecimal(value)) throw new Error(`${where} can't be sent to the browser`);
  if (Array.isArray(value)) value.forEach((v, i) => assertSendable(v, `${where}[${i}]`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => assertSendable(v, `${where}.${k}`));
}

const CLIENT = new Set<unknown>([ActionButton, FormDialog, JobBoard, DataBoard]);
const assertClientPropsSendable = (page: unknown) => {
  for (const e of elements(page).filter((e) => CLIENT.has(e.type))) assertSendable(e.props, (e.type as { name: string }).name);
};
const buttons = (page: unknown, label: string) => elements(page).filter((e) => e.type === ActionButton && e.props.label === label);
const params = (values: object = {}) => ({ searchParams: Promise.resolve(values) });

afterEach(() => vi.unstubAllEnvs());

/** A job with an invoice and an open payment link, as reception would have made it. */
async function openPayment(cookie: string) {
  const ctx = await makeJob();
  await call(addItemRoute, "POST", { cookie, params: { id: ctx.job.id }, body: { itemType: "PART", name: "Engine Oil", quantity: 1, unitPrice: 1500 } });
  const invoice = await generateInvoice(SYSTEM_ACTOR, ctx.job.id);
  const res = await call(createPayment, "POST", { cookie, body: { serviceJobId: ctx.job.id, notifyCustomer: false } });
  expect(res.status).toBe(201);
  fake.calls = [];
  return { ...ctx, invoice, payment: await db.payment.findUniqueOrThrow({ where: { id: res.json.data.id } }) };
}

describe("payment reminders", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let rita: string;

  beforeEach(async () => {
    admin = await makeUser("ADMIN", "Admin");
    rita = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
  });

  const remindPayment = (id: string, cookie = rita) => call(remind, "POST", { cookie, params: { id } });
  const notificationsOf = (serviceJobId: string) => db.notification.findMany({ where: { serviceJobId, kind: "PAYMENT_REQUEST" } });

  it("resends the same link and amount, makes no new link, and logs it", async () => {
    const { payment, job } = await openPayment(rita);
    const before = await db.payment.count();
    const res = await remindPayment(payment.id);
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ status: "SENT" });

    const sent = sendieeCalls();
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0].body)).toContain(payment.paymentLink);
    expect(JSON.stringify(sent[0].body)).toContain("1,500");
    expect(fake.calls.filter((c) => c.url.includes("payment_links"))).toEqual([]);

    expect(await db.payment.count()).toBe(before);
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.paymentLink).toBe(payment.paymentLink);
    expect(after.paymentOrderId).toBe(payment.paymentOrderId);
    expect(Number(after.amount)).toBe(Number(payment.amount));
    expect(after.status).toBe("PENDING");

    expect(await notificationsOf(job.id)).toMatchObject([{ status: "SENT" }]);
    const log = await db.activityLog.findFirstOrThrow({ where: { action: "PAYMENT_REMINDER_SENT", entityId: payment.id } });
    expect(log.summary).toBe(`Rita sent a payment reminder for ${job.serviceNumber}`);
  });

  it("takes no amount or link from the caller", async () => {
    const { payment } = await openPayment(rita);
    const res = await call(remind, "POST", { cookie: rita, params: { id: payment.id }, body: { amount: 1, paymentLink: "https://evil.test" } });
    expect(res.status).toBe(200);
    const body = JSON.stringify(sendieeCalls()[0].body);
    expect(body).toContain(payment.paymentLink);
    expect(body).not.toContain("evil.test");
  });

  it("refuses a worker and anyone not signed in, and sends nothing", async () => {
    const { payment } = await openPayment(rita);
    const worker = await loginCookie((await makeUser("WORKER", "Raj")).email);
    expect((await remindPayment(payment.id, worker)).status).toBe(403);
    expect((await call(remind, "POST", { params: { id: payment.id } })).status).toBe(401);
    expect(sendieeCalls()).toEqual([]);
  });

  it("lets an admin send one too", async () => {
    const { payment } = await openPayment(rita);
    expect((await remindPayment(payment.id, await loginCookie(admin.email))).status).toBe(200);
  });

  it("works on a payment in PROCESSING", async () => {
    const { payment } = await openPayment(rita);
    await db.payment.update({ where: { id: payment.id }, data: { status: "PROCESSING" } });
    expect((await remindPayment(payment.id)).status).toBe(200);
  });

  it.each([
    ["PAID", "PAYMENT_ALREADY_PAID"],
    ["CANCELLED", "PAYMENT_NOT_OPEN"],
    ["FAILED", "PAYMENT_NOT_OPEN"],
    ["REFUNDED", "PAYMENT_NOT_OPEN"],
  ] as const)("refuses a %s payment", async (status, code) => {
    const { payment } = await openPayment(rita);
    await db.payment.update({ where: { id: payment.id }, data: { status } });
    const res = await remindPayment(payment.id);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe(code);
    expect(sendieeCalls()).toEqual([]);
  });

  it("refuses a payment with no link, an unknown id, a cancelled job and a changed bill", async () => {
    const { payment, job, invoice } = await openPayment(rita);
    expect((await remindPayment("nope")).status).toBe(404);

    await db.invoice.update({ where: { id: invoice.id }, data: { total: 1600 } });
    expect((await remindPayment(payment.id)).json.error.code).toBe("BILL_CHANGED");
    await db.invoice.update({ where: { id: invoice.id }, data: { total: 1500 } });

    await db.serviceJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    expect((await remindPayment(payment.id)).json.error.code).toBe("SERVICE_CLOSED");
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "READY_FOR_DELIVERY" } });

    await db.payment.update({ where: { id: payment.id }, data: { paymentLink: null } });
    expect((await remindPayment(payment.id)).json.error.code).toBe("PAYMENT_LINK_MISSING");
    expect(sendieeCalls()).toEqual([]);
  });

  it("says so when the message is switched off, instead of claiming success", async () => {
    const { payment, job } = await openPayment(rita);
    await db.setting.create({ data: { key: "notify_PAYMENT_REQUEST", value: "false" } });
    const res = await remindPayment(payment.id);
    expect(res.status).toBe(409);
    expect(res.json.success).toBe(false);
    expect(res.json.error.code).toBe("REMINDER_NOT_SENT");
    expect(res.json.error.message).toContain("Turned off in Customer Messages");
    expect(sendieeCalls()).toEqual([]);
    expect(await notificationsOf(job.id)).toMatchObject([{ status: "SKIPPED" }]);
    expect(await db.activityLog.findFirst({ where: { action: "PAYMENT_REMINDER_SKIPPED", entityId: payment.id } })).not.toBeNull();
    expect(await db.activityLog.findFirst({ where: { action: "PAYMENT_REMINDER_SENT" } })).toBeNull();
  });

  it("says so when the 24-hour window is closed and there's no template", async () => {
    const { payment } = await openPayment(rita);
    await db.setting.create({ data: { key: "template_payment_request", value: "" } });
    const res = await remindPayment(payment.id);
    expect(res.status).toBe(409);
    expect(res.json.error.message).toContain("no template");
    expect(sendieeCalls()).toEqual([]);
  });

  it("surfaces a Sendiee failure", async () => {
    const { payment, job } = await openPayment(rita);
    fake.fail = { status: 400, code: "TEMPLATE_REJECTED" };
    const res = await remindPayment(payment.id);
    expect(res.status).toBe(502);
    expect(res.json.error.code).toBe("TEMPLATE_REJECTED");
    expect(res.json.error.message).toContain("nothing was sent");
    expect(await notificationsOf(job.id)).toMatchObject([{ status: "FAILED" }]);
    expect(await db.activityLog.findFirst({ where: { action: "PAYMENT_REMINDER_FAILED", entityId: payment.id } })).not.toBeNull();
  });

  describe("when the outcome of a send is unknown", () => {
    const expectUnconfirmed = (res: Awaited<ReturnType<typeof remindPayment>>, code: string) => {
      expect(res.status).toBe(502);
      expect(res.json.error.code).toBe(code);
      expect(res.json.error.message).toContain("may or may not have gone out");
      expect(res.json.error.message).toContain("before trying again");
      expect(res.json.error.message).not.toContain("nothing was sent");
    };

    it.each([
      ["a dropped connection", new TypeError("fetch failed")],
      ["a timeout", new DOMException("The operation timed out", "TimeoutError")],
    ])("doesn't claim nothing was sent after %s, and doesn't resend", async (_name, error) => {
      const { payment, job } = await openPayment(rita);
      fake.throws = error;
      expectUnconfirmed(await remindPayment(payment.id), "SENDIEE_UNREACHABLE");
      expect(sendieeCalls()).toHaveLength(1);
      expect(await notificationsOf(job.id)).toMatchObject([{ status: "FAILED", detail: "SENDIEE_UNREACHABLE" }]);
      const log = await db.activityLog.findFirstOrThrow({ where: { action: "PAYMENT_REMINDER_FAILED", entityId: payment.id } });
      expect(log.summary).toContain("could not be confirmed");
      expect(log.summary).not.toContain("was not sent");
    });

    it("treats a Sendiee server error the same way, since it isn't a refusal", async () => {
      const { payment } = await openPayment(rita);
      fake.fail = { status: 503, code: "BOOM" };
      expectUnconfirmed(await remindPayment(payment.id), "BOOM");
    });

    it("treats an unreadable reply to a send the same way", async () => {
      const { payment } = await openPayment(rita);
      vi.stubGlobal("fetch", async () => new Response("<html>ok</html>", { status: 200 }));
      expectUnconfirmed(await remindPayment(payment.id), "UNKNOWN_ERROR");
    });

    it("says the same when sending an invoice", async () => {
      const { invoice } = await openPayment(rita);
      fake.throws = new TypeError("fetch failed");
      expectUnconfirmed(await call(sendInvoiceRoute, "POST", { cookie: rita, params: { id: invoice.id } }), "SENDIEE_UNREACHABLE");
      expect(sendieeCalls()).toHaveLength(1);
      expect(await db.activityLog.findFirst({ where: { action: "INVOICE_SENT" } })).toBeNull();
    });

    it.each([400, 429])("still says nothing was sent when Sendiee refuses with a %i", async (status) => {
      const { payment, job } = await openPayment(rita);
      fake.fail = { status, code: "REFUSED" };
      const res = await remindPayment(payment.id);
      expect(res.json.error.message).toContain("nothing was sent");
      expect(res.json.error.message).not.toContain("may or may not");
      const log = await db.activityLog.findFirstOrThrow({ where: { action: "PAYMENT_REMINDER_FAILED", entityId: payment.id } });
      expect(log.summary).toBe(`Rita's payment reminder for ${job.serviceNumber} was not sent: REFUSED`);
    });
  });

  it("gives a clear error when WhatsApp isn't configured, without naming server settings", async () => {
    const { payment } = await openPayment(rita);
    vi.stubEnv("SENDIEE_API_KEY", "");
    const res = await remindPayment(payment.id);
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("WHATSAPP_NOT_CONFIGURED");
    expect(res.json.error.message).toContain("isn't set up");
    expect(res.json.error.message).not.toContain("SENDIEE_API_KEY");
  });
});

describe("sending an invoice", () => {
  let rita: string;
  beforeEach(async () => {
    rita = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
  });

  it("reports success only after a send, and surfaces each failure", async () => {
    const { invoice } = await openPayment(rita);
    const send = () => call(sendInvoiceRoute, "POST", { cookie: rita, params: { id: invoice.id } });

    vi.stubEnv("SENDIEE_BRAND_NUMBER", "");
    const missing = await send();
    expect(missing.status).toBe(503);
    expect(missing.json.error.code).toBe("WHATSAPP_NOT_CONFIGURED");
    expect(missing.json.error.message).not.toContain("SENDIEE_BRAND_NUMBER");
    vi.unstubAllEnvs();

    fake.fail = { status: 500, code: "BOOM" };
    const failed = await send();
    expect(failed.status).toBe(502);
    expect(failed.json.error.code).toBe("BOOM");
    fake.fail = null;

    await db.setting.create({ data: { key: "template_invoice", value: "" } });
    fake.calls = [];
    const noTemplate = await send();
    expect(noTemplate.status).toBe(409);
    expect(noTemplate.json.error.code).toBe("TEMPLATE_NOT_SET");
    expect(sendieeCalls()).toEqual([]);
    expect(await db.activityLog.findFirst({ where: { action: "INVOICE_SENT" } })).toBeNull();

    await db.setting.deleteMany({ where: { key: "template_invoice" } });
    expect((await send()).status).toBe(200);
    expect(sendieeCalls()).toHaveLength(1);
    expect(await db.activityLog.findFirst({ where: { action: "INVOICE_SENT" } })).not.toBeNull();
  });
});

describe("asking a customer to pay from the job page", () => {
  let cookie: string;
  beforeEach(async () => {
    const admin = await makeUser("ADMIN", "Admin");
    cookie = await loginCookie(admin.email);
    session.user = admin;
  });

  const jobPage = (id: string) => JobPage({ params: Promise.resolve({ id }) });
  const copyLinks = (page: unknown) => elements(page).filter((e) => e.type === CopyButton && e.props.label === "Copy payment link");
  const requests = (serviceJobId: string) => db.notification.findMany({ where: { serviceJobId, kind: "PAYMENT_REQUEST" } });

  async function invoicedJob() {
    const ctx = await makeJob();
    await call(addItemRoute, "POST", { cookie, params: { id: ctx.job.id }, body: { itemType: "PART", name: "Engine Oil", quantity: 1, unitPrice: 1500 } });
    await generateInvoice(SYSTEM_ACTOR, ctx.job.id);
    fake.calls = [];
    return ctx;
  }
  const create = (serviceJobId: string, notifyCustomer?: boolean) => call(createPayment, "POST", { cookie, body: { serviceJobId, notifyCustomer } });

  it("offers Resend on a live link, and pressing it really messages the customer", async () => {
    const { payment, job, customer } = await openPayment(cookie);
    const page = await jobPage(job.id);
    assertClientPropsSendable(page);
    const [button] = buttons(page, "Resend payment link");
    expect(button.props.endpoint).toBe(`/api/payments/${payment.id}/remind`);
    expect(button.props.success).toBe("Reminder sent on WhatsApp");
    expect(button.props.confirm).toContain(customer.name);
    expect(buttons(page, "Create payment request")).toEqual([]);
    expect(buttons(page, "Create new payment request")).toEqual([]);
    expect(copyLinks(page)).toHaveLength(1);

    const res = await call(remind, "POST", { cookie, params: { id: payment.id } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(sendieeCalls()[0].body)).toContain(payment.paymentLink);
    expect(await requests(job.id)).toMatchObject([{ status: "SENT" }]);
  });

  it("offers a first request through the create route when there's no payment", async () => {
    const { job } = await invoicedJob();
    const page = await jobPage(job.id);
    const [button] = buttons(page, "Create payment request");
    expect(button.props.endpoint).toBe("/api/payments/create");
    expect(button.props.body).toEqual({ serviceJobId: job.id, notifyCustomer: true });
    expect(buttons(page, "Resend payment link")).toEqual([]);
    expect(copyLinks(page)).toEqual([]);
  });

  it("offers a replacement once the bill has changed, so BILL_CHANGED has a way forward", async () => {
    const { payment, job, invoice } = await openPayment(cookie);
    await db.invoice.update({ where: { id: invoice.id }, data: { total: 1600 } });
    expect((await call(remind, "POST", { cookie, params: { id: payment.id } })).json.error.code).toBe("BILL_CHANGED");

    const page = await jobPage(job.id);
    assertClientPropsSendable(page);
    expect(buttons(page, "Resend payment link")).toEqual([]);
    expect(copyLinks(page)).toEqual([]);
    const [button] = buttons(page, "Create new payment request");
    expect(button.props.endpoint).toBe("/api/payments/create");
    expect(button.props.confirm).toContain("Cancel that link");

    const res = await call(createPayment, "POST", { cookie, body: button.props.body });
    expect(res.status).toBe(201);
    expect(res.json.data.warning).toBeNull();
    expect(Number(res.json.data.amount)).toBe(1600);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("CANCELLED");
    expect(sendieeCalls()).toHaveLength(1);
  });

  it("doesn't offer Resend on an open payment with no link", async () => {
    const { payment, job } = await openPayment(cookie);
    await db.payment.update({ where: { id: payment.id }, data: { paymentLink: null } });
    const page = await jobPage(job.id);
    expect(buttons(page, "Create payment request")).toHaveLength(1);
    expect(buttons(page, "Create payment request")[0].props.confirm).toBeUndefined();
    expect(buttons(page, "Resend payment link")).toEqual([]);
  });

  it("reports a sent message on a new link", async () => {
    const { job } = await invoicedJob();
    const res = await create(job.id, true);
    expect(res.status).toBe(201);
    expect(res.json.data.notification).toEqual({ status: "SENT" });
    expect(res.json.data.warning).toBeNull();
    expect(sendieeCalls()).toHaveLength(1);
  });

  it("warns when a new link's message was skipped, and keeps the link", async () => {
    const { job } = await invoicedJob();
    await db.setting.create({ data: { key: "notify_PAYMENT_REQUEST", value: "false" } });
    const res = await create(job.id, true);
    expect(res.status).toBe(201);
    expect(res.json.data.paymentLink).toBeTruthy();
    expect(res.json.data.notification.status).toBe("SKIPPED");
    expect(res.json.data.warning).toContain("no WhatsApp message was sent: Turned off in Customer Messages");
  });

  it("warns when a new link's message was refused, without naming server settings", async () => {
    const { job } = await invoicedJob();
    vi.stubEnv("SENDIEE_API_KEY", "");
    const res = await create(job.id, true);
    expect(res.status).toBe(201);
    expect(res.json.data.notification.status).toBe("FAILED");
    expect(res.json.data.warning).toContain("nothing was sent");
    expect(res.json.data.warning).not.toContain("SENDIEE_API_KEY");
  });

  it("warns that a new link's message may have gone out when that's unknown", async () => {
    const { job } = await invoicedJob();
    const fetchThrough = globalThis.fetch;
    vi.stubGlobal("fetch", (input: URL | string, init?: RequestInit) => {
      if (String(input).includes("/v2.0/whatsapp/")) throw new TypeError("fetch failed");
      return fetchThrough(input, init);
    });
    const res = await create(job.id, true);
    expect(res.status).toBe(201);
    expect(res.json.data.warning).toContain("may or may not have gone out");
    expect(res.json.data.warning).not.toContain("nothing was sent");
  });

  it("warns, and sends nothing, when a stale page asks for a request on a link that's already open", async () => {
    const { job } = await openPayment(cookie);
    const res = await create(job.id, true);
    expect(res.status).toBe(200);
    expect(res.json.data.notification).toBeNull();
    expect(res.json.data.warning).toContain("no WhatsApp message was sent");
    expect(sendieeCalls()).toEqual([]);
  });

  it("has nothing to warn about when no message was asked for", async () => {
    const { job } = await invoicedJob();
    for (const expected of [201, 200]) {
      const res = await create(job.id, false);
      expect(res.status).toBe(expected);
      expect(res.json.data.notification).toBeNull();
      expect(res.json.data.warning).toBeNull();
    }
    expect(sendieeCalls()).toEqual([]);
  });

  it("shows the warning instead of the success message", () => {
    const success = vi.spyOn(toast, "success").mockReturnValue(1);
    const warning = vi.spyOn(toast, "warning").mockReturnValue(1);
    showResult({ warning: "Careful" }, "All good");
    expect(warning).toHaveBeenCalledWith("Careful");
    expect(success).not.toHaveBeenCalled();
    showResult({ warning: null }, "All good");
    showResult(null, "All good");
    expect(success).toHaveBeenCalledTimes(2);
    showResult(null);
    expect(success).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});

describe("the Billing page", () => {
  let cookie: string;
  beforeEach(async () => {
    const admin = await makeUser("ADMIN", "Admin");
    cookie = await loginCookie(admin.email);
    session.user = admin;
  });

  it("opens on Payments, and shows invoices on their tab, as tables whatever ?view says", async () => {
    const { invoice, payment } = await openPayment(cookie);
    for (const view of [undefined, "list"]) {
      const payments = await AdminBilling(params({ view }));
      assertClientPropsSendable(payments);
      expect(buttons(payments, "Send reminder").map((b) => b.props.endpoint)).toEqual([`/api/payments/${payment.id}/remind`]);
      expect(buttons(payments, "Send reminder")[0].props.confirm).toBeTruthy();
      const paymentsText = await html(payments);
      expect(paymentsText).toContain("Status changes only come from verified");
      expect(paymentsText).not.toContain(invoice.invoiceNumber);

      const invoices = await AdminBilling(params({ view, tab: "invoices" }));
      assertClientPropsSendable(invoices);
      expect(buttons(invoices, "Send on WhatsApp").map((b) => b.props.endpoint)).toEqual([`/api/invoices/${invoice.id}/send`]);
      expect(buttons(invoices, "Send on WhatsApp")[0].props.confirm).toBeTruthy();
      expect(await html(invoices)).toContain(invoice.invoiceNumber);
    }
    for (const view of [undefined, "list", "board", ["list", "x"]]) {
      for (const tab of ["payments", "invoices"]) {
        const page = await AdminBilling(params({ view, tab }));
        expect(elements(page).some((e) => e.type === DataBoard)).toBe(false);
        const text = await html(page);
        expect(text).not.toContain("Kanban");
        expect(text).toContain("<table");
      }
    }
  });

  it("offers a reminder only on an open payment with a link", async () => {
    const { payment } = await openPayment(cookie);
    const count = async () => buttons(await AdminBilling(params()), "Send reminder").length;
    expect(await count()).toBe(1);
    await db.payment.update({ where: { id: payment.id }, data: { paymentLink: null } });
    expect(await count()).toBe(0);
    await db.payment.update({ where: { id: payment.id }, data: { paymentLink: "https://rzp.io/x", status: "PROCESSING" } });
    expect(await count()).toBe(1);
    for (const status of ["PAID", "FAILED", "REFUNDED", "CANCELLED"] as const) {
      await db.payment.update({ where: { id: payment.id }, data: { status } });
      expect(await count()).toBe(0);
    }
  });

  it("shows payment status as a coloured tag, and keeps the invoice's download", async () => {
    const { invoice } = await openPayment(cookie);
    expect(await html(await AdminBilling(params()))).toMatch(/<span class="[^"]*bg-[^"]*">Pending<\/span>/);
    const invoices = await html(await AdminBilling(params({ tab: "invoices" })));
    expect(invoices).toMatch(/<span class="[^"]*bg-[^"]*">Pending<\/span>/);
    expect(invoices).toContain(`href="/api/invoices/${invoice.id}/pdf"`);
    expect(invoices).toContain('href="?tab=payments"');
  });

  it("falls back safely on junk in the query", async () => {
    for (const tab of ["'; DROP TABLE", "INVOICES", "__proto__", ["invoices", "payments"], ""]) {
      const text = await html(await AdminBilling(params({ tab })));
      expect(text).toContain("Status changes only come from verified");
    }
    expect(pickTab(undefined, ["a", "b"] as const)).toBe("a");
    expect(pickTab("b", ["a", "b"] as const)).toBe("b");
    expect(pickTab("constructor", ["a", "b"] as const)).toBe("a");
    expect(pickTab(["b"], ["a", "b"] as const)).toBe("a");
  });

  it("shows reception payments only, whatever the URL asks for", async () => {
    const { invoice, payment } = await openPayment(cookie);
    session.user = await makeUser("RECEPTIONIST", "Rita");
    const page = await ReceptionBilling();
    assertClientPropsSendable(page);
    const text = await html(page);
    expect(text).not.toContain(invoice.invoiceNumber);
    expect(text).not.toContain(">Invoices<");
    expect(buttons(page, "Send on WhatsApp")).toEqual([]);
    expect(buttons(page, "Send reminder").map((b) => b.props.endpoint)).toEqual([`/api/payments/${payment.id}/remind`]);
  });

  it("guards each page for its own role", async () => {
    const worker = await makeUser("WORKER", "Raj");
    const reception = await makeUser("RECEPTIONIST", "Rita");
    for (const user of [worker, reception, null]) {
      session.user = user;
      await expect(AdminBilling(params())).rejects.toThrow("REFUSED");
      await expect(OldPayments()).rejects.toThrow("REFUSED");
      await expect(OldInvoices()).rejects.toThrow("REFUSED");
    }
    session.user = worker;
    await expect(ReceptionBilling()).rejects.toThrow("REFUSED");
    await expect(OldReceptionPayments()).rejects.toThrow("REFUSED");
  });

  describe("old links", () => {
    const pageFor = (url: string) => `app${url.split("?")[0]}/page.tsx`;

    it("redirect to pages that exist, dropping the old view", async () => {
      const go = async (page: () => Promise<unknown>) => {
        const err = await page().then(() => null, (e: Error) => e);
        expect(err?.message).toMatch(/^REDIRECT:/);
        const to = err!.message.slice("REDIRECT:".length);
        expect(existsSync(pageFor(to)), to).toBe(true);
        return to;
      };
      expect(await go(OldPayments)).toBe("/admin/billing?tab=payments");
      expect(await go(OldInvoices)).toBe("/admin/billing?tab=invoices");
      session.user = await makeUser("RECEPTIONIST", "Rita");
      expect(await go(OldReceptionPayments)).toBe("/reception/billing");
      expect(existsSync("app/admin/invoices/[id]/page.tsx")).toBe(true);
    });
  });

  it("has one Billing menu item with the right active state, and no Add customer in the header", async () => {
    const shell = (role: Role) => html(createElement(Shell, { role, name: "X", garage: "Car's Spa", children: null }));
    const admin = await shell("ADMIN");
    expect(admin).toContain('href="/admin/billing"');
    expect(admin).not.toContain('href="/admin/payments"');
    expect(admin).not.toContain('href="/admin/invoices"');
    expect(admin).toMatch(/aria-current="page"[^>]*>.*Billing/);
    const reception = await shell("RECEPTIONIST");
    expect(reception).toContain('href="/reception/billing"');
    expect(reception).not.toContain('href="/reception/payments"');
    expect(await shell("WORKER")).not.toContain("illing");
    for (const role of ["ADMIN", "RECEPTIONIST", "WORKER"] as const) expect(await shell(role)).not.toContain("Add customer");

    expect(navActive("/admin/billing", "/admin/billing", "/admin")).toBe(true);
    expect(navActive("/admin/billing", "/admin/invoices/abc", "/admin")).toBe(true);
    expect(navActive("/admin/billing", "/admin/customers-jobs", "/admin")).toBe(false);
    expect(navActive("/reception/billing", "/reception/billing", "/reception")).toBe(true);
    expect(navActive("/admin/customers-jobs", "/admin/vehicles/1", "/admin")).toBe(true);
    expect(navActive("/admin/employees", "/admin/staff/1", "/admin")).toBe(true);
  });

  it("no source links to the old list pages except their redirects", () => {
    for (const file of ["components/shell.tsx", "components/billing-view.tsx", "app/admin/invoices/[id]/page.tsx", "app/admin/jobs/[id]/page.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/["'`](\/admin\/(payments|invoices)|\/reception\/payments)["'`?]/);
    }
  });
});

describe("Services and Parts tabs", () => {
  beforeEach(async () => {
    session.user = await makeUser("ADMIN", "Admin");
    await db.serviceType.createMany({ data: [{ name: "Car Wash", rate: 300 }, { name: "Brake Pads", kind: "PART", rate: 2000 }] });
  });

  it("show one kind at a time, as a table whatever ?view says", async () => {
    for (const view of [undefined, "list"]) {
      const services = await html(await ServiceTypesPage(params({ view })));
      expect(services).toContain("Car Wash");
      expect(services).not.toContain("Brake Pads");
      const parts = await html(await ServiceTypesPage(params({ view, kind: "part" })));
      expect(parts).toContain("Brake Pads");
      expect(parts).not.toContain("Car Wash");
    }
    const parts = await ServiceTypesPage(params({ view: "list", kind: "part" }));
    expect(elements(parts).some((e) => e.type === DataBoard)).toBe(false);
    const list = await html(parts);
    expect(list).not.toContain("Kanban");
    expect(list).toContain('href="?kind=service"');
    expect(list).toContain('href="?kind=part"');
  });

  it("flag a request waiting on the other tab", async () => {
    await db.serviceType.update({ where: { name: "Brake Pads" }, data: { proposedRate: 2500, proposedBy: "Rita" } });
    expect(await html(await ServiceTypesPage(params()))).toContain("1 waiting");
  });

  it("fall back safely on junk", async () => {
    for (const kind of ["PARTS", "<script>", ["part", "service"], "__proto__"]) {
      const admin = await html(await ServiceTypesPage(params({ kind })));
      expect(admin).toContain("Car Wash");
      expect(admin).not.toContain("<script>");
      expect(await html(await RatesView({ kind }))).toContain("Car Wash");
    }
    expect(await html(await RatesView({ kind: "part" }))).toContain("Brake Pads");
  });

  it("offer a rate on both add forms", async () => {
    for (const page of [await ServiceTypesPage(params()), await ServiceTypesPage(params({ kind: "part" }))]) {
      const add = elements(page).filter((e) => e.type === FormDialog && String(e.props.trigger).startsWith("+ Add"));
      expect(add).toHaveLength(2);
      for (const form of add) {
        const rate = (form.props.fields as { name: string; required?: boolean }[]).find((f) => f.name === "rate");
        expect(rate).toBeTruthy();
        expect(rate?.required).toBeFalsy();
      }
    }
    const reception = elements(await RatesView({})).find((e) => e.type === FormDialog && e.props.trigger === "+ Add part");
    expect((reception!.props.fields as { name: string; required?: boolean }[]).find((f) => f.name === "rate")?.required).toBeFalsy();
  });
});

describe("a rate when adding a service or part", () => {
  let admin: string, rita: string, raj: string;
  beforeEach(async () => {
    admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    rita = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    raj = await loginCookie((await makeUser("WORKER", "Raj")).email);
  });
  const row = (name: string) => db.serviceType.findUniqueOrThrow({ where: { name } });
  const add = (cookie: string, body: object) => call(addType, "POST", { cookie, body });

  it("applies at once for an admin, on services and parts", async () => {
    expect((await add(admin, { name: "Polish", kind: "SERVICE", rate: "750.50" })).status).toBe(201);
    expect((await add(admin, { name: "Horn", kind: "PART", rate: "450" })).status).toBe(201);
    expect(Number((await row("Polish")).rate)).toBe(750.5);
    expect((await row("Polish")).proposedRate).toBeNull();
    expect((await billPrices()).Horn).toBe(450);
  });

  it("goes to approval for reception and workers", async () => {
    for (const [cookie, name, by] of [[rita, "Air Horn", "Rita"], [raj, "Wiper", "Raj"]]) {
      expect((await add(cookie, { name, kind: "PART", rate: "450" })).status).toBe(201);
      const type = await row(name);
      expect(type.rate).toBeNull();
      expect(Number(type.proposedRate)).toBe(450);
      expect(type.proposedBy).toBe(by);
      expect((await billPrices())[name]).toBeUndefined();
    }
    expect((await add(rita, { name: "New Service", rate: "100" })).status).toBe(403);
    expect((await add(raj, { name: "Other Service", kind: "SERVICE" })).status).toBe(403);
  });

  it("means no rate when blank, for anyone", async () => {
    for (const [cookie, name] of [[admin, "A"], [rita, "B"], [raj, "C"]]) {
      for (const [suffix, rate] of [["1", ""], ["2", "   "], ["3", null]] as const) {
        expect((await add(cookie, { name: name + suffix, kind: "PART", rate })).status).toBe(201);
        expect(await row(name + suffix)).toMatchObject({ rate: null, proposedRate: null, proposedBy: null, proposedAt: null });
      }
    }
    expect((await add(admin, { name: "No rate key", kind: "SERVICE" })).status).toBe(201);
    expect(await db.staffNotification.count({ where: { title: "Rate change requested" } })).toBe(0);
  });

  it.each(["abc", "-5", "1,000", "100000001", "10.123", "Infinity", true, -1])("refuses %s", async (rate) => {
    const res = await add(admin, { name: "Bad", kind: "PART", rate });
    expect(res.status).toBe(400);
    expect(await db.serviceType.count({ where: { name: "Bad" } })).toBe(0);
  });

  it("allows zero and two decimal places", async () => {
    expect((await add(admin, { name: "Free", rate: "0" })).status).toBe(201);
    expect(Number((await row("Free")).rate)).toBe(0);
    expect((await add(admin, { name: "Cheap", rate: 1.1 })).status).toBe(201);
  });
});

describe("the Kanban edit form's estimate", () => {
  const field = { name: "serviceType", label: "Service type", fills: { field: "estimatedAmount", values: { Wash: 300, Polish: 750.5 } } };

  it("follows the new service's rate, and leaves it for a service with none", () => {
    expect(filledValue(field, "Polish", "Wash", "500")).toBe("750.5");
    expect(filledValue(field, "No Rate", "Wash", "500")).toBeUndefined();
  });

  it("goes back to what it opened with on returning to the first service", () => {
    expect(filledValue(field, "Wash", "Wash", "500")).toBe("500");
    expect(filledValue(field, "Wash", "Wash", "")).toBe("");
  });

  it("does nothing on a select without fills", () => {
    expect(filledValue({ name: "x", label: "X" }, "a", "b", "c")).toBeUndefined();
  });

  it("is saved as whatever the form holds, so it can be typed over", () => {
    const form = new FormData();
    form.set("estimatedAmount", "999");
    expect(formValues([{ name: "estimatedAmount", label: "E", type: "number" }], form)).toEqual({ estimatedAmount: "999" });
  });

  it("gets approved service rates only, and parts never reach the list", async () => {
    session.user = await makeUser("ADMIN", "Admin");
    await db.serviceType.createMany({
      data: [
        { name: "Wash", rate: 300 },
        { name: "Polish", rate: 750.5 },
        { name: "Requested Only", proposedRate: 900, proposedBy: "Rita" },
        { name: "No Rate" },
        { name: "Hidden", rate: 100, active: false },
        { name: "Brake Pads", kind: "PART", rate: 2000 },
      ],
    });
    await makeJob("Wash");
    const page = await CustomersJobsPage(params() as { searchParams: Promise<Record<string, string>> });
    assertClientPropsSendable(page);
    const board = elements(page).find((e) => e.type === JobBoard)!;
    expect(board.props.rates).toEqual({ Wash: 300, Polish: 750.5 });
    expect(board.props.serviceTypes).toEqual(["No Rate", "Polish", "Requested Only", "Wash"]);
    expect(readFileSync("components/job-board.tsx", "utf8")).toContain('fills: { field: "estimatedAmount", values: rates }');
  });
});

describe("the banner", () => {
  it("rotates the real clips, every one of them on disk", () => {
    expect(CLIPS.garage).toEqual(["paint-booth", "panel-repair", "jet-wash", "car-wash-inside", "open-road"]);
    for (const clip of Object.values(CLIPS).flat()) {
      expect(existsSync(`public/media/${clip}.mp4`), clip).toBe(true);
      expect(existsSync(`public/media/${clip}.jpg`), clip).toBe(true);
    }
  });

  it("uses plain black, with no navy or violet anywhere near it", () => {
    expect(SIDE_OVERLAY).toContain("from-black/55");
    expect(SIDE_OVERLAY).toContain("md:to-50%");
    expect(EVEN_OVERLAY).toContain("bg-black");
    for (const file of ["components/live-scene.tsx", "lib/media-clips.ts", "app/track/[token]/page.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/0B1033|slate-950|slate-300|violet|navy/i);
    }
    expect(readFileSync("app/admin/dashboard/page.tsx", "utf8")).not.toMatch(/0B1033|slate-300/);
    expect(readFileSync("app/track/[token]/page.tsx", "utf8")).toContain("overlay={EVEN_OVERLAY}");
  });

  it("is documented", () => {
    const docs = readFileSync("docs/MEDIA.md", "utf8");
    for (const id of ["coverr-mechanic-working-on-a-car-953", "coverr-man-hammering-a-car-piece-4161", "coverr-washing-car-with-a-jet-5415", "coverr-pov-car-wash-9339"]) expect(docs).toContain(id);
  });
});
