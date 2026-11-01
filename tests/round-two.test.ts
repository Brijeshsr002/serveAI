import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type Role } from "@prisma/client";
import { POST as markAttendance } from "@/app/api/attendance/mark/route";
import { GET as overviewRoute } from "@/app/api/customers/[id]/overview/route";
import { GET as invoicePdf } from "@/app/api/invoices/[id]/pdf/route";
import { POST as markRead } from "@/app/api/notifications/read/route";
import { GET as notificationsRoute } from "@/app/api/notifications/route";
import { GET as drilldownRoute } from "@/app/api/reports/drilldown/route";
import { GET as search } from "@/app/api/search/route";
import { POST as decide } from "@/app/api/service-types/[id]/rate/decision/route";
import { POST as setRate } from "@/app/api/service-types/[id]/rate/route";
import { GET as listTypes, POST as addType } from "@/app/api/service-types/route";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { CHANGELOG, LATEST_VERSION } from "@/lib/changelog";
import { db } from "@/lib/db";
import { addDayKey, addDays, dayKeyToDate, istMonthKey, monthRangeIST, startOfDayIST } from "@/lib/format";
import { todayKey } from "@/lib/services/attendance";
import { generateInvoice } from "@/lib/services/invoices";
import { assignWorker, createJob, workersWithLoad } from "@/lib/services/jobs";
import { chartData } from "@/lib/services/reports";
import { activePartNames, billPrices, defaultRate } from "@/lib/services/service-rates";
import { replyForMessage } from "@/lib/services/whatsapp-commands";
import { DEFAULT_PRICE_LIST, parsePriceList, PART_NAMES } from "@/lib/work-catalog";
import { call, loginCookie, makeCustomer, makeJob, makeUser, makeVehicle, openWindow, sendieeCalls } from "./helpers";

const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; email: string; phone: string | null; role: Role } }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/admin/customers",
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
vi.mock("@/lib/auth/page", () => ({
  currentUser: async () => session.user,
  requireRole: async (roles: Role[]) => {
    if (!session.user || !roles.includes(session.user.role)) throw new Error("REDIRECT");
    return session.user;
  },
}));
vi.mock("@/components/live-scene", () => ({ LiveScene: ({ children }: { children: unknown }) => children }));

const { default: CustomersPage } = await import("@/app/admin/customers/page");
const { default: VehiclesPage } = await import("@/app/admin/vehicles/page");
const { default: JobsPage } = await import("@/app/admin/jobs/page");
const { default: ServiceTypesPage } = await import("@/app/admin/service-types/page");
const { default: ReportsPage } = await import("@/app/admin/reports/page");
const { default: UpdatesPage } = await import("@/app/admin/updates/page");
const { default: SettingsPage } = await import("@/app/admin/settings/page");
const { RatesView } = await import("@/components/rates-view");
const { Shell } = await import("@/components/shell");
const { JobBoard } = await import("@/components/job-board");
const { NewJobDialog } = await import("@/components/job-form");
const { FormDialog, ActionButton } = await import("@/components/actions");
const { DataBoard } = await import("@/components/data-board-client");
const { CustomerViewButton } = await import("@/components/customer-view");
const { SingleBarChart, WorkerChart } = await import("@/components/charts");

async function html(element: ReactElement) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
}

const CLIENT = new Set<unknown>([JobBoard, NewJobDialog, FormDialog, ActionButton, DataBoard, CustomerViewButton, SingleBarChart, WorkerChart]);

/** Every element in a server page's tree, including ones handed over as props. */
function elements(node: unknown, found: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => elements(n, found));
  else if (isValidElement(node)) {
    found.push(node as ReactElement<Record<string, unknown>>);
    Object.values(node.props as object).forEach((v) => elements(v, found));
  } else if (node && typeof node === "object" && Object.getPrototypeOf(node) === Object.prototype) Object.values(node).forEach((v) => elements(v, found));
  return found;
}

/** Throws on what React can't send to a client component: this has crashed the app before. */
function assertSendable(value: unknown, where: string) {
  if (isValidElement(value)) return;
  if (typeof value === "function" || value instanceof Date || Prisma.Decimal.isDecimal(value)) throw new Error(`${where} can't be sent to the browser`);
  if (Array.isArray(value)) value.forEach((v, i) => assertSendable(v, `${where}[${i}]`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => assertSendable(v, `${where}.${k}`));
}

function assertClientPropsSendable(page: unknown) {
  const clients = elements(page).filter((e) => CLIENT.has(e.type));
  expect(clients.length).toBeGreaterThan(0);
  for (const e of clients) assertSendable(e.props, (e.type as { name: string }).name);
}

const asUser = (u: { id: string; name: string; email: string; phone: string | null; role: Role }) => { session.user = u; };
const noParams = Promise.resolve({});

let serial = 0;
/** A fresh customer and vehicle with an open job, optionally assigned. */
async function openJob(workerId?: string, serviceType = "General Service") {
  serial++;
  const customer = await makeCustomer(`91900000${String(serial).padStart(4, "0")}`, `Customer ${serial}`);
  const vehicle = await makeVehicle(customer.id, `TN01AA${String(serial).padStart(4, "0")}`);
  const job = await createJob(SYSTEM_ACTOR, { customerId: customer.id, vehicleId: vehicle.id, serviceType, customerComplaint: null, internalNotes: null, estimatedAmount: 1000, appointmentDate: null, expectedCompletion: null, assignedWorkerId: workerId });
  return { customer, vehicle, job };
}

const autoAssignOn = () => db.setting.create({ data: { key: "auto_assign_enabled", value: "true" } });
const jobsOf = (workerId: string) => db.serviceJob.count({ where: { assignedWorkerId: workerId } });

describe("top search", () => {
  let cookie: string;
  beforeEach(async () => {
    cookie = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
  });
  const find = async (q: string) => (await call(search, "GET", { cookie, path: `/api/search?q=${encodeURIComponent(q)}` })).json.data;

  it("finds by name, phone and vehicle number", async () => {
    const { customer, vehicle } = await makeJob();
    expect((await find("Brijesh")).customers[0].id).toBe(customer.id);
    expect((await find("9876543210")).customers[0].id).toBe(customer.id);
    const byReg = await find("tn38 ab-1234");
    expect(byReg.vehicles[0].id).toBe(vehicle.id);
    expect(byReg.customers[0].id).toBe(customer.id);
  });

  it("returns no services or invoices, and doesn't match on their numbers", async () => {
    const { customer, job } = await makeJob();
    await db.serviceItem.create({ data: { serviceJobId: job.id, itemType: "SERVICE", name: "Wash", unitPrice: 100, total: 100 } });
    const invoice = await generateInvoice(SYSTEM_ACTOR, job.id);
    const result = await find("TN38AB1234");
    expect(Object.keys(result).sort()).toEqual(["customers", "vehicles"]);
    for (const q of [job.serviceNumber, invoice.invoiceNumber, customer.customerCode]) {
      expect(await find(q), q).toEqual({ customers: [], vehicles: [] });
    }
  });

  it("is staff only", async () => {
    const worker = await loginCookie((await makeUser("WORKER", "Raj")).email);
    expect((await call(search, "GET", { cookie: worker, path: "/api/search?q=abc" })).status).toBe(403);
  });
});

describe("customers page", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;
  beforeEach(async () => {
    admin = await makeUser("ADMIN", "Admin");
    asUser(admin);
  });

  it("shows one card per customer listing all their vehicles, and a board card only once", async () => {
    const { customer } = await makeJob();
    await makeVehicle(customer.id, "TN38ZZ9999", "Venue");
    const page = await CustomersPage({ searchParams: Promise.resolve({}) });
    const board = elements(page).find((e) => e.type === DataBoard)!;
    const cards = (board.props.columns as { cards: { id: string }[] }[]).flatMap((c) => c.cards);
    expect(cards.map((c) => c.id)).toEqual([customer.id]);
    const text = await html(page);
    expect(text).toContain("TN38AB1234");
    expect(text).toContain("TN38ZZ9999");
    expect(text.match(/View Brijesh/g)?.length).toBeGreaterThan(0);
    expect(text).toContain("Add vehicle");
  });

  it("finds a customer by registration in both views, without repeating them", async () => {
    const { customer } = await makeJob();
    await makeVehicle(customer.id, "TN38AB5555", "Venue");
    await makeCustomer("919000011111", "Other Person");
    for (const view of [undefined, "list"]) {
      const page = await CustomersPage({ searchParams: Promise.resolve({ q: "TN38AB", view }) });
      const text = await html(page);
      expect(text).toContain("Brijesh");
      expect(text).not.toContain("Other Person");
    }
    const page = await CustomersPage({ searchParams: Promise.resolve({ q: "TN38AB" }) });
    const board = elements(page).find((e) => e.type === DataBoard)!;
    expect((board.props.columns as { cards: unknown[] }[]).flatMap((c) => c.cards)).toHaveLength(1);
  });

  it("only passes plain values to client components", async () => {
    await makeJob();
    assertClientPropsSendable(await CustomersPage({ searchParams: Promise.resolve({}) }));
    assertClientPropsSendable(await CustomersPage({ searchParams: Promise.resolve({ view: "list" }) }));
  });

  it("redirects the vehicles list to the customers page for each role", async () => {
    await expect(VehiclesPage({ searchParams: noParams })).rejects.toThrow("REDIRECT:/admin/customers");
    asUser(await makeUser("RECEPTIONIST", "Rita"));
    await expect(VehiclesPage({ searchParams: Promise.resolve({ q: "TN 38" }) })).rejects.toThrow("REDIRECT:/reception/customers?q=TN%2038");
    asUser(await makeUser("WORKER", "Raj"));
    await expect(VehiclesPage({ searchParams: noParams })).rejects.toThrow("REDIRECT");
  });

  it("takes Vehicles out of the sidebars", async () => {
    for (const role of ["ADMIN", "RECEPTIONIST", "WORKER"] as Role[]) {
      const text = await html(createElement(Shell, { role, name: "X", garage: "Car's Spa", children: null }));
      expect(text, role).not.toContain("/vehicles");
    }
  });

  it("the view dialog's record has it all, as plain values, for staff only", async () => {
    const { customer, job } = await makeJob();
    await db.customer.update({ where: { id: customer.id }, data: { notes: "Prefers mornings", email: "b@test.local" } });
    await db.payment.create({ data: { serviceJobId: job.id, customerId: customer.id, amount: 3000, paymentProvider: "razorpay", status: "PENDING" } });
    const closed = await openJob();
    await db.serviceJob.update({ where: { id: closed.job.id }, data: { customerId: customer.id, vehicleId: (await makeVehicle(customer.id, "TN38YY0001")).id, status: "COMPLETED" } });
    const cookie = await loginCookie(admin.email);
    const { status, json } = await call(overviewRoute, "GET", { cookie, params: { id: customer.id } });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ notes: "Prefers mornings", email: "b@test.local", payment: { latestStatus: "PENDING", due: "₹3,000.00" } });
    expect(json.data.vehicles.map((v: { registrationNumber: string }) => v.registrationNumber)).toEqual(["TN38AB1234", "TN38YY0001"]);
    expect(json.data.activeJobs.map((j: { id: string }) => j.id)).toEqual([job.id]);
    expect(json.data.recentJobs.map((j: { id: string }) => j.id)).toEqual([closed.job.id]);
    const worker = await loginCookie((await makeUser("WORKER", "Raj")).email);
    expect((await call(overviewRoute, "GET", { cookie: worker, params: { id: customer.id } })).status).toBe(403);
    expect((await call(overviewRoute, "GET", { cookie, params: { id: "missing" } })).status).toBe(404);
  });
});

describe("chart drilldown", () => {
  let admin: string;
  beforeEach(async () => {
    admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
  });
  const drill = async (query: Record<string, string>) => {
    const { status, json } = await call(drilldownRoute, "GET", { cookie: admin, path: `/api/reports/drilldown?${new URLSearchParams(query)}` });
    expect(status).toBe(200);
    return json.data;
  };
  const paid = (jobId: string, customerId: string, amount: number, paidAt: Date) =>
    db.payment.create({ data: { serviceJobId: jobId, customerId, amount, paymentProvider: "razorpay", status: "PAID", paidAt } });

  it("is admin only", async () => {
    const reception = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    const worker = await loginCookie((await makeUser("WORKER", "Raj")).email);
    const path = "/api/reports/drilldown?kind=status&value=NEW";
    expect((await call(drilldownRoute, "GET", { cookie: reception, path })).status).toBe(403);
    expect((await call(drilldownRoute, "GET", { cookie: worker, path })).status).toBe(403);
    expect((await call(drilldownRoute, "GET", { path })).status).toBe(401);
  });

  it("rejects bad parameters", async () => {
    for (const q of ["kind=status&value=NOPE", "kind=status&value=constructor", "kind=day&value=2026-13-45", "kind=month&value=2026-1", "kind=nope&value=x", "kind=type", "kind=worker&value=x&bucket=nope"]) {
      expect((await call(drilldownRoute, "GET", { cookie: admin, path: `/api/reports/drilldown?${q}` })).status, q).toBe(400);
    }
    expect((await call(drilldownRoute, "GET", { cookie: admin, path: "/api/reports/drilldown?kind=worker&value=missing" })).status).toBe(404);
  });

  it("day and month totals equal their bars, using IST days", async () => {
    const { job, customer } = await openJob();
    const dayStart = addDays(startOfDayIST(), -2);
    await paid(job.id, customer.id, 1000.1, dayStart); // first instant of the IST day, though still the day before in UTC
    await paid(job.id, customer.id, 200.2, new Date(addDays(dayStart, 1).getTime() - 1));
    await paid(job.id, customer.id, 5000, new Date(dayStart.getTime() - 1)); // last instant of the IST day before
    await db.payment.create({ data: { serviceJobId: job.id, customerId: customer.id, amount: 777, paymentProvider: "razorpay", status: "PENDING" } });

    const charts = await chartData();
    for (const bar of charts.dailyRevenue) {
      const data = await drill({ kind: "day", value: String(bar.key) });
      expect(data.total, bar.key).toBe(bar.value);
    }
    const twoDaysAgo = await drill({ kind: "day", value: addDayKey(todayKey(), -2) });
    expect(twoDaysAgo).toMatchObject({ type: "payments", total: 1200.3, count: 2 });
    expect(twoDaysAgo.rows).toHaveLength(2);
    expect(twoDaysAgo.totalLabel).toBe("₹1,200.30");

    for (const bar of charts.monthlyRevenue) expect((await drill({ kind: "month", value: String(bar.key) })).total, bar.key).toBe(bar.value);
    const empty = await drill({ kind: "day", value: "2020-01-01" });
    expect(empty).toMatchObject({ count: 0, total: 0, rows: [] });
  });

  it("the oldest month's bar is the whole month, so it matches too", async () => {
    const { job, customer } = await openJob();
    const oldest = istMonthKey(addDays(startOfDayIST(), -365));
    await paid(job.id, customer.id, 50, monthRangeIST(oldest).start);
    const bar = (await chartData()).monthlyRevenue.find((m) => m.key === oldest);
    expect(bar?.value).toBe(50);
    expect((await drill({ kind: "month", value: oldest })).total).toBe(50);
  });

  it("status, type and worker rows list the same jobs as their bars", async () => {
    const worker = await makeUser("WORKER", "Raj");
    await openJob(worker.id, "Car Wash");
    await openJob(worker.id, "Car Wash");
    const done = await openJob(worker.id, "AC Service");
    await db.serviceJob.update({ where: { id: done.job.id }, data: { status: "COMPLETED" } });
    await openJob(undefined, "Car Wash");

    const charts = await chartData();
    for (const bar of charts.byStatus) {
      const data = await drill({ kind: "status", value: String(bar.key) });
      expect(data.count, bar.name).toBe(bar.value);
      expect(data.rows, bar.name).toHaveLength(bar.value);
    }
    for (const bar of charts.byType) expect((await drill({ kind: "type", value: String(bar.key) })).count, bar.name).toBe(bar.value);
    const [row] = charts.workerPerformance;
    expect(row).toMatchObject({ name: "Raj", completed: 1, active: 2 });
    expect((await drill({ kind: "worker", value: row.key, bucket: "completed" })).count).toBe(row.completed);
    expect((await drill({ kind: "worker", value: row.key, bucket: "active" })).count).toBe(row.active);
    const all = await drill({ kind: "worker", value: row.key });
    expect(all.count).toBe(3);
    expect(all.title).toBe("Raj's jobs");
    expect(all.rows[0]).toMatchObject({ workerName: "Raj", phone: expect.any(String), registrationNumber: expect.any(String) });
  });

  it("renders bars as buttons on the reports page, with plain props", async () => {
    const worker = await makeUser("WORKER", "Raj");
    await openJob(worker.id, "Car Wash");
    asUser(await db.user.findFirstOrThrow({ where: { role: "ADMIN" } }));
    const page = await ReportsPage();
    assertClientPropsSendable(page);
    const text = await html(page);
    expect(text).toContain("Car Wash: 1. Show the jobs");
    expect(text).toContain("Raj, Active: 1. Show the jobs");
  });
});

describe("parts", () => {
  beforeEach(async () => {
    await db.serviceType.createMany({
      data: [
        { name: "Car Wash", rate: 300 },
        { name: "Brake Pads", kind: "PART", rate: 2000 },
        { name: "Horn", kind: "PART" },
      ],
    });
  });

  it("stays out of the job service type lists", async () => {
    asUser(await makeUser("ADMIN", "Admin"));
    for (const view of [undefined, "list"]) {
      const dialog = elements(await JobsPage({ searchParams: Promise.resolve({ view }) })).find((e) => e.type === NewJobDialog)!;
      expect(dialog.props.serviceTypes).toEqual(["Car Wash"]);
      expect(dialog.props.rates).toEqual({ "Car Wash": 300 });
    }
    await openJob();
    const board = elements(await JobsPage({ searchParams: Promise.resolve({}) })).find((e) => e.type === JobBoard)!;
    expect(board.props.serviceTypes).toEqual(["Car Wash"]);
    const cookie = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    const names = async (q: string) => (await call(listTypes, "GET", { cookie, path: `/api/service-types${q}` })).json.data.map((t: { name: string }) => t.name);
    expect(await names("")).toEqual(["Car Wash"]);
    expect(await names("?kind=PART")).toEqual(["Brake Pads", "Horn"]);
  });

  it("stays out of WhatsApp booking and the price reply", async () => {
    const { customer } = await (async () => {
      const c = await makeCustomer("919111111111", "Enquirer");
      await makeVehicle(c.id, "TN38CC0001");
      await openWindow(c.id);
      return { customer: c };
    })();
    await db.setting.create({ data: { key: "booking_enabled", value: "true" } });
    const booking = await replyForMessage(customer, "book");
    expect(booking?.reply).toContain("Car Wash");
    expect(booking?.reply).not.toContain("Brake Pads");
    const pending = (await db.whatsappConversation.findUniqueOrThrow({ where: { customerId: customer.id } })).pendingChoice as { types: string[] };
    expect(pending.types).toEqual(["Car Wash"]);
    await db.whatsappConversation.update({ where: { customerId: customer.id }, data: { pendingChoice: Prisma.DbNull } });
    const prices = await replyForMessage(customer, "how much?");
    expect(prices?.reply).toContain("Car Wash");
    expect(prices?.reply).not.toContain("Brake Pads");
  });

  it("isn't used to price a job, even if its name is sent as the service", async () => {
    expect(await defaultRate("Brake Pads")).toBeNull();
    expect(Number(await defaultRate("Car Wash"))).toBe(300);
  });

  it("feeds approved rates into the bill prices, over the price list", async () => {
    await db.setting.create({ data: { key: "price_list", value: "Brake Pads = 1\nFallback Item = 55" } });
    const prices = await billPrices();
    expect(prices).toMatchObject({ "Brake Pads": 2000, "Car Wash": 300, "Fallback Item": 55 });
    expect(prices.Horn).toBeUndefined();
    await db.serviceType.update({ where: { name: "Brake Pads" }, data: { proposedRate: 9999 } });
    expect((await billPrices())["Brake Pads"]).toBe(2000);
    expect(await activePartNames()).toEqual(["Brake Pads", "Horn"]);
  });

  it("goes through the same approval as a service rate", async () => {
    const admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const worker = await loginCookie((await makeUser("WORKER", "Raj")).email);
    const id = (await db.serviceType.findUniqueOrThrow({ where: { name: "Brake Pads" } })).id;
    await call(setRate, "POST", { cookie: worker, params: { id }, body: { rate: 2500 } });
    expect((await billPrices())["Brake Pads"]).toBe(2000);
    await call(decide, "POST", { cookie: admin, params: { id }, body: { approve: true } });
    expect((await billPrices())["Brake Pads"]).toBe(2500);
  });

  it("can be added: at once by an admin, and pending approval by anyone else, who can't add a service", async () => {
    const admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const rita = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    expect((await call(addType, "POST", { cookie: admin, body: { name: "Turbo Hose", kind: "PART", rate: "900" } })).status).toBe(201);
    expect((await billPrices())["Turbo Hose"]).toBe(900);
    expect((await call(addType, "POST", { cookie: rita, body: { name: "Air Horn", kind: "PART", rate: "450" } })).status).toBe(201);
    expect((await billPrices())["Air Horn"]).toBeUndefined();
    expect(await db.serviceType.findUniqueOrThrow({ where: { name: "Air Horn" } })).toMatchObject({ kind: "PART", rate: null, proposedBy: "Rita" });
    expect((await call(addType, "POST", { cookie: rita, body: { name: "No Price", kind: "PART", rate: "" } })).status).toBe(400);
    expect((await call(addType, "POST", { cookie: rita, body: { name: "New Service" } })).status).toBe(403);
    expect((await call(addType, "POST", { cookie: admin, body: { name: "Horn", kind: "PART" } })).status).toBe(409);
    expect((await call(addType, "POST", { cookie: admin, body: { name: "Plain Service", rate: "" } })).status).toBe(201);
    expect(await db.serviceType.findUniqueOrThrow({ where: { name: "Plain Service" } })).toMatchObject({ kind: "SERVICE", rate: null });
  });

  it("shows services and parts separately on the rates and service types pages", async () => {
    asUser(await makeUser("ADMIN", "Admin"));
    const rates = await html(await RatesView());
    expect(rates.indexOf("Car Wash")).toBeLessThan(rates.indexOf("Add part"));
    expect(rates.indexOf("Add part")).toBeLessThan(rates.indexOf("Brake Pads"));
    for (const view of [undefined, "list"]) {
      const page = await ServiceTypesPage({ searchParams: Promise.resolve({ view }) });
      assertClientPropsSendable(page);
      const text = await html(page);
      expect(text.indexOf(">Services<")).toBeLessThan(text.indexOf("Car Wash"));
      expect(text.indexOf(">Parts<")).toBeGreaterThan(text.indexOf("Car Wash"));
      expect(text.indexOf(">Parts<")).toBeLessThan(text.indexOf("Brake Pads"));
    }
  });

  describe("migration", () => {
    const sql = readFileSync("prisma/migrations/20261101050000_service_type_kind/migration.sql", "utf8");
    const insert = sql.match(/INSERT INTO "service_types"[\s\S]*?ON CONFLICT DO NOTHING;/)![0];

    it("inserts every catalog part with its draft price, and leaves existing rows alone", async () => {
      await db.serviceType.deleteMany();
      await db.serviceType.create({ data: { name: "Battery", rate: 111 } });
      await db.$executeRawUnsafe(insert);
      await db.$executeRawUnsafe(insert);
      const rows = await db.serviceType.findMany();
      expect(rows).toHaveLength(PART_NAMES.length);
      const draft = parsePriceList(DEFAULT_PRICE_LIST);
      for (const name of PART_NAMES) {
        const row = rows.find((r) => r.name === name)!;
        if (name === "Battery") continue;
        expect(row.kind, name).toBe("PART");
        expect(row.rate === null ? undefined : Number(row.rate), name).toBe(draft[name]);
      }
      expect(rows.find((r) => r.name === "Battery")).toMatchObject({ kind: "SERVICE" });
      expect(Number(rows.find((r) => r.name === "Battery")!.rate)).toBe(111);
    });
  });
});

describe("rate notifications", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>, rita: Awaited<ReturnType<typeof makeUser>>, raj: Awaited<ReturnType<typeof makeUser>>;
  let cookies: Record<"admin" | "rita" | "raj", string>;
  let id: string;

  beforeEach(async () => {
    [admin, , rita, raj] = await Promise.all([makeUser("ADMIN", "Admin"), makeUser("ADMIN", "Boss"), makeUser("RECEPTIONIST", "Rita"), makeUser("WORKER", "Raj"), makeUser("WORKER", "Sam")]);
    await makeUser("WORKER", "Gone").then((u) => db.user.update({ where: { id: u.id }, data: { active: false } }));
    await makeUser("ADMIN", "Exboss").then((u) => db.user.update({ where: { id: u.id }, data: { active: false } }));
    cookies = { admin: await loginCookie(admin.email), rita: await loginCookie(rita.email), raj: await loginCookie(raj.email) };
    id = (await db.serviceType.create({ data: { name: "Brake Pads", kind: "PART", rate: 2000 } })).id;
  });

  const recipients = async () => (await db.staffNotification.findMany({ include: { user: { select: { name: true } } } })).map((n) => n.user.name).sort();
  const feed = async (cookie: string) => (await call(notificationsRoute, "GET", { cookie })).json.data;

  it("tells active admins of a request, with no one else told", async () => {
    await call(setRate, "POST", { cookie: cookies.raj, params: { id }, body: { rate: 2500 } });
    expect(await recipients()).toEqual(["Admin", "Boss"]);
    const [note] = (await feed(cookies.admin)).items;
    expect(note).toMatchObject({ title: "Rate change requested", link: "/admin/service-types" });
    expect(note.body).toContain("Raj");
    expect(note.body).toContain("Brake Pads");
    expect(note.body).toContain("₹2,500");
  });

  it("tells active reception and workers when an admin sets a rate, naming the item and price", async () => {
    await call(setRate, "POST", { cookie: cookies.admin, params: { id }, body: { rate: 2200 } });
    expect(await recipients()).toEqual(["Raj", "Rita", "Sam"]);
    const rows = await db.staffNotification.findMany({ where: { userId: rita.id } });
    expect(rows[0].body).toBe("Brake Pads is now ₹2,200.");
    expect(rows[0].link).toBe("/reception/service-rates");
    expect((await db.staffNotification.findFirstOrThrow({ where: { userId: raj.id } })).link).toBe("/worker/service-rates");
  });

  it("tells them when a request is approved", async () => {
    await call(setRate, "POST", { cookie: cookies.rita, params: { id }, body: { rate: 2500 } });
    await db.staffNotification.deleteMany();
    await call(decide, "POST", { cookie: cookies.admin, params: { id }, body: { approve: true } });
    expect(await recipients()).toEqual(["Raj", "Rita", "Sam"]);
    expect((await feed(cookies.raj)).items[0].body).toBe("Brake Pads is now ₹2,500.");
  });

  it("stays quiet when an admin saves the same rate", async () => {
    await call(setRate, "POST", { cookie: cookies.admin, params: { id }, body: { rate: 2000 } });
    expect(await recipients()).toEqual([]);
  });

  it("tells only the requester when rejected", async () => {
    await call(setRate, "POST", { cookie: cookies.raj, params: { id }, body: { rate: 2500 } });
    await db.staffNotification.deleteMany();
    await call(decide, "POST", { cookie: cookies.admin, params: { id }, body: { approve: false } });
    expect(await recipients()).toEqual(["Raj"]);
    expect((await feed(cookies.raj)).items[0]).toMatchObject({ title: "Rate request rejected", link: "/worker/service-rates" });
    expect((await db.serviceType.findUniqueOrThrow({ where: { id } })).proposedById).toBeNull();
  });

  it("finds the requester by name for requests made before ids were kept", async () => {
    await db.serviceType.update({ where: { id }, data: { proposedRate: 2500, proposedBy: "Rita", proposedAt: new Date() } });
    await call(decide, "POST", { cookie: cookies.admin, params: { id }, body: { approve: false } });
    expect(await recipients()).toEqual(["Rita"]);
  });

  it("lets each person read and clear only their own", async () => {
    await call(setRate, "POST", { cookie: cookies.admin, params: { id }, body: { rate: 2200 } });
    const mine = await feed(cookies.rita);
    expect(mine.unread).toBe(1);
    expect(mine.items).toHaveLength(1);
    expect((await feed(cookies.admin)).items).toEqual([]);
    const theirs = await db.staffNotification.findFirstOrThrow({ where: { userId: raj.id } });
    const attempt = await call(markRead, "POST", { cookie: cookies.rita, body: { ids: [theirs.id] } });
    expect(attempt.status).toBe(200);
    expect((await db.staffNotification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
    expect((await feed(cookies.rita)).unread).toBe(1);
    const cleared = await call(markRead, "POST", { cookie: cookies.rita, body: { ids: [mine.items[0].id] } });
    expect(cleared.json.data.unread).toBe(0);
    expect((await feed(cookies.raj)).unread).toBe(1);
    // What the bell sends on opening: all of your own, including any older than the list shows.
    await db.staffNotification.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ userId: rita.id, title: "Old", body: String(i) })) });
    expect((await call(markRead, "POST", { cookie: cookies.rita, body: {} })).json.data.unread).toBe(0);
    expect((await feed(cookies.raj)).unread).toBe(1);
    expect((await call(notificationsRoute, "GET", {})).status).toBe(401);
  });

  it("never lets a failed notification block the rate change", async () => {
    const spy = vi.spyOn(db.staffNotification, "createMany").mockRejectedValue(new Error("down"));
    try {
      expect((await call(setRate, "POST", { cookie: cookies.admin, params: { id }, body: { rate: 2300 } })).status).toBe(200);
      expect(Number((await db.serviceType.findUniqueOrThrow({ where: { id } })).rate)).toBe(2300);
      expect((await call(setRate, "POST", { cookie: cookies.raj, params: { id }, body: { rate: 2400 } })).status).toBe(200);
      expect((await call(decide, "POST", { cookie: cookies.admin, params: { id }, body: { approve: false } })).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("doesn't use WhatsApp for any of it", async () => {
    await call(setRate, "POST", { cookie: cookies.raj, params: { id }, body: { rate: 2500 } });
    await call(decide, "POST", { cookie: cookies.admin, params: { id }, body: { approve: true } });
    expect(sendieeCalls()).toEqual([]);
  });
});

describe("kanban cards", () => {
  const job = {
    id: "j1", serviceNumber: "SRV-1", serviceType: "Car Wash", status: "ASSIGNED" as const, priority: "NORMAL" as const, customerName: "Brijesh", registrationNumber: "TN38AB1234", vehicleName: "Hyundai Creta",
    workerId: "w2", workerName: "Sam", estimate: "₹300", appointment: null as string | null,
    edit: { customerComplaint: null, internalNotes: null, estimatedAmount: null, appointmentDate: null, expectedCompletion: null },
  };
  const workers = [
    { id: "w1", name: "Raj Kumar", activeJobs: 2, onLeave: false },
    { id: "w2", name: "Sam Peter", activeJobs: 1, onLeave: true },
  ];

  it("lists worker names in the assign dropdown, marking who is on leave, and flags the card", async () => {
    const text = await html(createElement(JobBoard, { jobs: [job], counts: { ASSIGNED: 1 }, base: "/admin", workers, serviceTypes: ["Car Wash"] }));
    expect(text).toMatch(/<option value="w1"[^>]*>Raj Kumar \(2 active\)<\/option>/);
    expect(text).toMatch(/<option value="w2"[^>]*>Sam Peter \(on leave\)<\/option>/);
    expect(text).toContain("On leave");
  });

  it("doesn't flag a closed job or someone at work", async () => {
    const closed = await html(createElement(JobBoard, { jobs: [{ ...job, status: "COMPLETED" as const }], counts: {}, base: "/admin", workers, serviceTypes: [] }));
    expect(closed).not.toContain(">On leave<");
    const atWork = await html(createElement(JobBoard, { jobs: [{ ...job, workerId: "w1", workerName: "Raj Kumar" }], counts: {}, base: "/admin", workers, serviceTypes: [] }));
    expect(atWork).not.toContain(">On leave<");
  });

  it("says so when there's nobody to assign", async () => {
    const text = await html(createElement(JobBoard, { jobs: [{ ...job, workerId: null, workerName: null }], counts: {}, base: "/admin", workers: [], serviceTypes: [] }));
    expect(text).toContain("No active workers");
  });

  it("shows a booked slot, and workers from the database with today's leave, through the real page", async () => {
    asUser(await makeUser("ADMIN", "Admin"));
    const raj = await makeUser("WORKER", "Raj");
    const sam = await makeUser("WORKER", "Sam");
    await db.attendance.create({ data: { userId: sam.id, date: dayKeyToDate(todayKey()), status: "LEAVE" } });
    await db.attendance.create({ data: { userId: raj.id, date: dayKeyToDate(addDayKey(todayKey(), 1)), status: "LEAVE" } });
    const { job: created } = await openJob(sam.id);
    await db.serviceJob.update({ where: { id: created.id }, data: { appointmentDate: new Date("2026-11-03T04:30:00.000Z") } });
    const page = await JobsPage({ searchParams: Promise.resolve({}) });
    assertClientPropsSendable(page);
    const text = await html(page);
    expect(text).toMatch(/Booked 3 Nov 2026, 10:00/i);
    expect(text).toContain("Sam (on leave)");
    expect(text).toContain("Raj (0 active)");
    expect(text).toContain(">On leave<");
  });
});

describe("leave handling", () => {
  let admin: string, adminId: string;
  beforeEach(async () => {
    const user = await makeUser("ADMIN", "Admin");
    adminId = user.id;
    admin = await loginCookie(user.email);
  });
  const leave = (userId: string, date = todayKey()) => call(markAttendance, "POST", { cookie: admin, body: { userId, date, action: "leave" } });

  it("moves nothing while the switch is off, which is the default", async () => {
    const [ann, bob] = [await makeUser("WORKER", "Ann"), await makeUser("WORKER", "Bob")];
    await openJob(ann.id);
    expect((await db.setting.findUnique({ where: { key: "auto_assign_enabled" } }))).toBeNull();
    expect((await leave(ann.id)).status).toBe(200);
    expect(await jobsOf(ann.id)).toBe(1);
    expect(await jobsOf(bob.id)).toBe(0);
    const { job } = await openJob();
    expect(job.assignedWorkerId).toBeNull();
    expect(job.status).toBe("NEW");
  });

  it("spreads today's leave one job at a time to whoever has the fewest", async () => {
    const [ann, bob, lea] = [await makeUser("WORKER", "Ann"), await makeUser("WORKER", "Bob"), await makeUser("WORKER", "Lea")];
    await openJob(bob.id);
    await openJob(bob.id);
    for (let i = 0; i < 4; i++) await openJob(lea.id);
    const done = await openJob(lea.id);
    await db.serviceJob.update({ where: { id: done.job.id }, data: { status: "COMPLETED" } });
    await autoAssignOn();
    const before = sendieeCalls().length;

    expect((await leave(lea.id)).status).toBe(200);

    expect(await db.serviceJob.count({ where: { assignedWorkerId: ann.id } })).toBe(3);
    expect(await db.serviceJob.count({ where: { assignedWorkerId: bob.id } })).toBe(3);
    // A closed job stays with whoever did it.
    expect((await db.serviceJob.findUniqueOrThrow({ where: { id: done.job.id } })).assignedWorkerId).toBe(lea.id);
    expect(sendieeCalls().length).toBe(before);
    const moves = await db.activityLog.findMany({ where: { action: "SERVICE_REASSIGNED" } });
    expect(moves).toHaveLength(4);
    expect(moves[0].summary).toContain("Lea is on leave");
    expect(moves[0].metadata).toMatchObject({ previousWorkerId: lea.id });
  });

  it("never messages the customer, even for a job still marked New", async () => {
    const [lea] = [await makeUser("WORKER", "Lea"), await makeUser("WORKER", "Bob")];
    const { job } = await openJob(lea.id);
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "NEW" } });
    await autoAssignOn();
    const before = sendieeCalls().length;
    await leave(lea.id);
    expect(sendieeCalls().length).toBe(before);
    expect((await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).assignedWorkerId).not.toBe(lea.id);
  });

  it("skips anyone on leave today or inactive", async () => {
    const [ann, bob, off, gone] = [await makeUser("WORKER", "Ann"), await makeUser("WORKER", "Bob"), await makeUser("WORKER", "Off"), await makeUser("WORKER", "Gone")];
    await db.attendance.create({ data: { userId: off.id, date: dayKeyToDate(todayKey()), status: "LEAVE" } });
    await db.user.update({ where: { id: gone.id }, data: { active: false } });
    // Leave on another day doesn't take someone out of the running today.
    await db.attendance.create({ data: { userId: bob.id, date: dayKeyToDate(addDayKey(todayKey(), 2)), status: "LEAVE" } });
    for (let i = 0; i < 2; i++) await openJob(ann.id);
    await autoAssignOn();
    await leave(ann.id);
    expect(await jobsOf(bob.id)).toBe(2);
    expect(await jobsOf(off.id)).toBe(0);
    expect(await jobsOf(gone.id)).toBe(0);
  });

  it("leaves the jobs and logs it when nobody is available", async () => {
    const lea = await makeUser("WORKER", "Lea");
    for (let i = 0; i < 2; i++) await openJob(lea.id);
    await autoAssignOn();
    expect((await leave(lea.id)).status).toBe(200);
    expect(await jobsOf(lea.id)).toBe(2);
    const [log] = await db.activityLog.findMany({ where: { action: "AUTO_ASSIGN_SKIPPED" } });
    expect(log.summary).toContain("Lea is on leave");
    expect(await db.activityLog.count({ where: { action: "SERVICE_REASSIGNED" } })).toBe(0);
  });

  it("moves nothing for leave dated in the future", async () => {
    const [lea, bob] = [await makeUser("WORKER", "Lea"), await makeUser("WORKER", "Bob")];
    await openJob(lea.id);
    await autoAssignOn();
    expect((await leave(lea.id, addDayKey(todayKey(), 3))).status).toBe(200);
    expect(await jobsOf(lea.id)).toBe(1);
    expect(await jobsOf(bob.id)).toBe(0);
    // Still working today, so still in the running for new jobs.
    expect((await workersWithLoad()).find((w) => w.id === lea.id)?.onLeave).toBe(false);
  });

  it("assigns new jobs fairly and leaves those with a chosen worker alone", async () => {
    const [ann, bob, off] = [await makeUser("WORKER", "Ann"), await makeUser("WORKER", "Bob"), await makeUser("WORKER", "Off")];
    await db.attendance.create({ data: { userId: off.id, date: dayKeyToDate(todayKey()), status: "LEAVE" } });
    await autoAssignOn();
    const order: (string | null)[] = [];
    for (let i = 0; i < 4; i++) order.push((await openJob()).job.assignedWorkerId);
    expect(order).toEqual([ann.id, bob.id, ann.id, bob.id]);
    const chosen = await openJob(off.id);
    expect(chosen.job.assignedWorkerId).toBe(off.id);
    const next = await openJob();
    expect(next.job.assignedWorkerId).toBe(ann.id);
    expect(next.job.status).toBe("ASSIGNED");
    expect(await db.activityLog.count({ where: { entityId: next.job.id, action: "SERVICE_ASSIGNED" } })).toBe(1);
  });

  it("leaves a new job unassigned and logs it when nobody is available", async () => {
    const off = await makeUser("WORKER", "Off");
    await db.attendance.create({ data: { userId: off.id, date: dayKeyToDate(todayKey()), status: "LEAVE" } });
    await autoAssignOn();
    const { job } = await openJob();
    expect(job).toMatchObject({ assignedWorkerId: null, status: "NEW" });
    expect(await db.activityLog.count({ where: { entityId: job.id, action: "AUTO_ASSIGN_SKIPPED" } })).toBe(1);
  });

  it("still lets staff assign someone on leave by hand", async () => {
    const off = await makeUser("WORKER", "Off");
    await db.attendance.create({ data: { userId: off.id, date: dayKeyToDate(todayKey()), status: "LEAVE" } });
    const { job } = await openJob();
    expect((await assignWorker({ id: adminId, role: "ADMIN", name: "Admin" }, job.id, off.id)).assignedWorkerId).toBe(off.id);
  });

  it("has a switch in Settings", async () => {
    asUser(await db.user.findUniqueOrThrow({ where: { id: adminId } }));
    const page = await SettingsPage();
    const form = elements(page).find((e) => (e.props as { groups?: unknown }).groups)!;
    const fields = (form.props.groups as { fields: { key: string; toggle?: boolean }[] }[]).flatMap((g) => g.fields);
    expect(fields.find((f) => f.key === "auto_assign_enabled")?.toggle).toBe(true);
    expect((form.props.values as Record<string, string>).auto_assign_enabled).toBe("false");
    expect(fields.some((f) => f.key === "center_email")).toBe(true);
  });
});

describe("invoice", () => {
  /** PDF text is compressed, with glyphs mapped back to characters by its ToUnicode tables. */
  const decodedStreams = (pdf: Buffer) => {
    const raw = pdf.toString("latin1");
    const out: string[] = [];
    for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try {
        out.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"));
      } catch {
        // Not compressed text, such as the background photo.
      }
    }
    return out;
  };

  const invoicedJob = async () => {
    const { job } = await makeJob();
    await db.serviceItem.create({ data: { serviceJobId: job.id, itemType: "PART", name: "Brake Pads", quantity: 2, unitPrice: 2000, total: 4000 } });
    return generateInvoice(SYSTEM_ACTOR, job.id);
  };

  it("embeds the rupee sign and draws amounts with it", async () => {
    const cookie = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    await db.setting.createMany({ data: [{ key: "center_phone", value: "+91 98765 43210" }, { key: "center_address", value: "12 Main Road" }, { key: "center_email", value: "hello@carsspa.test" }] });
    const invoice = await invoicedJob();
    const { status, res } = await call(invoicePdf, "GET", { cookie, params: { id: invoice.id } });
    expect(status).toBe(200);
    const pdf = Buffer.from(await res.arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const streams = decodedStreams(pdf);
    expect(streams.some((s) => /beginbfrange[\s\S]*20b9/i.test(s))).toBe(true);
    // Vector icons mean real curves were drawn in the page, on top of the logo's.
    expect(streams.some((s) => / c\n/.test(s))).toBe(true);
    expect(readFileSync("lib/invoices/pdf.ts", "utf8")).not.toContain('"Rs.');
  });

  it("still renders with every contact field blank", async () => {
    const cookie = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const invoice = await invoicedJob();
    const { status, res } = await call(invoicePdf, "GET", { cookie, params: { id: invoice.id } });
    expect(status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});

describe("updates page", () => {
  it("lists versions newest first, and only admins get the page and the label", async () => {
    const admin = await makeUser("ADMIN", "Admin");
    asUser(admin);
    expect(LATEST_VERSION).toBe(CHANGELOG[CHANGELOG.length - 1].version);
    const text = await html(await UpdatesPage());
    expect(text.indexOf(`v${LATEST_VERSION}`)).toBeLessThan(text.indexOf(`v${CHANGELOG[0].version}`));
    expect(text).not.toContain("ServeAI");

    const shell = (role: Role) => html(createElement(Shell, { role, name: "X", garage: "Car's Spa", children: null }));
    expect(await shell("ADMIN")).toContain(`v${LATEST_VERSION}`);
    for (const role of ["RECEPTIONIST", "WORKER"] as Role[]) {
      expect(await shell(role)).not.toContain("/admin/updates");
      asUser(await makeUser(role, role === "WORKER" ? "Raj" : "Rita"));
      await expect(UpdatesPage()).rejects.toThrow("REDIRECT");
    }
  });

  it("puts a bell in every role's top bar, and the top search says what it covers", async () => {
    for (const role of ["ADMIN", "RECEPTIONIST", "WORKER"] as Role[]) {
      expect(await html(createElement(Shell, { role, name: "X", garage: "Car's Spa", children: null }))).toContain('aria-label="Notifications"');
    }
    expect(await html(createElement(Shell, { role: "ADMIN", name: "X", garage: "Car's Spa", children: null }))).toContain('placeholder="Search name, phone or vehicle number"');
  });
});

describe("chart colours", () => {
  const source = readFileSync("components/charts.tsx", "utf8");

  it("are the soft palette, with the old strong ones gone", () => {
    for (const c of ["#8B7CF6", "#4FD1C5", "#7DB5F5", "#F58FBF", "#F7C96B", "#B39DF8", "#67D4E8", "#B5DE6B", "#A7B4C6"]) expect(source).toContain(c);
    for (const c of ["#4A2BE8", "#0E9F8E", "#2563EB", "#DB2777", "#D97706", "#7C3AED", "#0891B2", "#65A30D", "#475569"]) expect(source).not.toContain(c);
  });
});

