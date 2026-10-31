import { beforeEach, describe, expect, it } from "vitest";
import { POST as createPayment } from "@/app/api/payments/create/route";
import { POST as addItemRoute } from "@/app/api/service-jobs/[id]/items/route";
import { POST as createInvoice } from "@/app/api/invoices/route";
import { GET as invoicePdf } from "@/app/api/invoices/[id]/pdf/route";
import { POST as payWebhook } from "@/app/api/webhooks/payment/route";
import { db } from "@/lib/db";
import { generateInvoice, lineTotal } from "@/lib/services/invoices";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { stripe } from "@/lib/payments/stripe";
import { createHmac } from "node:crypto";
import { call, fake, loginCookie, makeJob, makeUser, razorpaySignature, sendieeCalls } from "./helpers";

let cookie: string;

beforeEach(async () => {
  cookie = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
});

const item = (over: object = {}) => ({ itemType: "PART", name: "Engine Oil", quantity: 4, unitPrice: 500, ...over });

async function billedJob() {
  const ctx = await makeJob();
  await call(addItemRoute, "POST", { cookie, params: { id: ctx.job.id }, body: item() });
  await call(addItemRoute, "POST", { cookie, params: { id: ctx.job.id }, body: item({ itemType: "PART", name: "Oil Filter", quantity: 1, unitPrice: 500 }) });
  await call(addItemRoute, "POST", { cookie, params: { id: ctx.job.id }, body: item({ itemType: "LABOUR", name: "Labour", quantity: 1, unitPrice: 1000 }) });
  await generateInvoice(SYSTEM_ACTOR, ctx.job.id);
  return ctx;
}

function linkPaid(linkId: string, amountPaise: number, eventId = "evt_1") {
  const raw = JSON.stringify({
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: linkId, amount_paid: amountPaise } },
      payment: { entity: { id: "pay_123" } },
    },
  });
  return { raw, headers: { "x-razorpay-signature": razorpaySignature(raw), "x-razorpay-event-id": eventId } };
}

describe("invoices", () => {
  it("computes the spec's example bill exactly", async () => {
    const { job } = await billedJob();
    const invoice = await db.invoice.findUniqueOrThrow({ where: { serviceJobId: job.id } });
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-000001$/);
    expect(Number(invoice.total)).toBe(3500);
    expect(Number(invoice.partsTotal)).toBe(2500);
    expect(Number(invoice.labourTotal)).toBe(1000);
    expect(Number((await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).finalAmount)).toBe(3500);
  });

  it("avoids floating point errors in line totals", () => {
    expect(lineTotal({ quantity: 3, unitPrice: 0.1, tax: 0, discount: 0 })).toBe(0.3);
    expect(lineTotal({ quantity: 1, unitPrice: 1000, tax: 180, discount: 100 })).toBe(1080);
  });

  it("refuses an empty invoice and produces a real PDF", async () => {
    const { job } = await makeJob();
    const empty = await call(createInvoice, "POST", { cookie, body: { serviceJobId: job.id } });
    expect(empty.status).toBe(409);
    const billed = await call(addItemRoute, "POST", { cookie, params: { id: job.id }, body: item() });
    expect(billed.status).toBe(201);
    const invoice = await call(createInvoice, "POST", { cookie, body: { serviceJobId: job.id } });
    const { res } = await call(invoicePdf, "GET", { cookie, params: { id: invoice.json.data.id } });
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("payment creation", () => {
  it("takes the amount from the invoice and ignores any amount sent by the client", async () => {
    const { job, customer } = await billedJob();
    const { status, json } = await call(createPayment, "POST", {
      cookie,
      body: { serviceJobId: job.id, amount: 1, status: "PAID" },
    });
    expect(status).toBe(201);
    expect(Number(json.data.amount)).toBe(3500);
    expect(json.data.status).toBe("PENDING");
    const rzp = fake.calls.find((c) => c.url.includes("/v1/payment_links"))!;
    expect(rzp.body.amount).toBe(350000);
    expect(rzp.body.customer.contact).toBe(`+${customer.phone}`);
    expect(rzp.headers.Authorization.startsWith("Basic ")).toBe(true);
  });

  it("needs an invoice first", async () => {
    const { job } = await makeJob();
    const { status, json } = await call(createPayment, "POST", { cookie, body: { serviceJobId: job.id } });
    expect(status).toBe(409);
    expect(json.error.code).toBe("INVOICE_REQUIRED");
  });

  it("reuses the open link rather than creating a second one", async () => {
    const { job } = await billedJob();
    const a = await call(createPayment, "POST", { cookie, body: { serviceJobId: job.id } });
    const b = await call(createPayment, "POST", { cookie, body: { serviceJobId: job.id } });
    expect(b.status).toBe(200);
    expect(b.json.data.id).toBe(a.json.data.id);
    expect(await db.payment.count()).toBe(1);
  });

  it("cannot produce two open links from a double click", async () => {
    const { job } = await billedJob();
    await Promise.all([1, 2, 3].map(() => call(createPayment, "POST", { cookie, body: { serviceJobId: job.id } })));
    expect(await db.payment.count({ where: { status: "PENDING" } })).toBe(1);
  });

  it("cancels the old link when the bill changes", async () => {
    const { job } = await billedJob();
    const a = await call(createPayment, "POST", { cookie, body: { serviceJobId: job.id } });
    await call(addItemRoute, "POST", { cookie, params: { id: job.id }, body: item({ name: "Wiper", quantity: 1, unitPrice: 300 }) });
    await generateInvoice(SYSTEM_ACTOR, job.id);
    const b = await call(createPayment, "POST", { cookie, body: { serviceJobId: job.id } });
    expect(Number(b.json.data.amount)).toBe(3800);
    expect((await db.payment.findUniqueOrThrow({ where: { id: a.json.data.id } })).status).toBe("CANCELLED");
    expect(fake.calls.some((c) => c.url.endsWith(`/cancel`))).toBe(true);
  });

  it("does not leave a row behind when the provider fails", async () => {
    const { job } = await billedJob();
    fake.fail = { status: 500, code: "x" };
    const { status } = await call(createPayment, "POST", { cookie, body: { serviceJobId: job.id } });
    expect(status).toBe(502);
    expect(await db.payment.count()).toBe(0);
  });
});

describe("payment webhook", () => {
  async function pendingPayment() {
    const ctx = await billedJob();
    const { json } = await call(createPayment, "POST", { cookie, body: { serviceJobId: ctx.job.id } });
    fake.calls = [];
    return { ...ctx, payment: json.data };
  }

  it("rejects a bad signature and leaves the payment unpaid", async () => {
    const { payment } = await pendingPayment();
    const { raw } = linkPaid(payment.paymentOrderId, 350000);
    const { status } = await call(payWebhook, "POST", { raw, headers: { "x-razorpay-signature": "0".repeat(64) } });
    expect(status).toBe(401);
    const noSig = await call(payWebhook, "POST", { raw });
    expect(noSig.status).toBe(401);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
  });

  it("rejects a body altered after signing", async () => {
    const { payment } = await pendingPayment();
    const { headers } = linkPaid(payment.paymentOrderId, 100);
    const { raw } = linkPaid(payment.paymentOrderId, 350000);
    expect((await call(payWebhook, "POST", { raw, headers })).status).toBe(401);
  });

  it("marks paid on a valid event and confirms on WhatsApp", async () => {
    const { payment } = await pendingPayment();
    const { raw, headers } = linkPaid(payment.paymentOrderId, 350000);
    const { status, json } = await call(payWebhook, "POST", { raw, headers });
    expect(status).toBe(200);
    expect(json.data.outcome).toBe("paid");
    const row = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row).toMatchObject({ status: "PAID", paymentId: "pay_123" });
    expect(row.paidAt).not.toBeNull();
    expect(sendieeCalls()).toHaveLength(1);
    expect(await db.activityLog.count({ where: { action: "PAYMENT_RECEIVED", actorRole: "CUSTOMER" } })).toBe(1);
  });

  it("is idempotent: redelivery and racing deliveries confirm once", async () => {
    const { payment } = await pendingPayment();
    const { raw, headers } = linkPaid(payment.paymentOrderId, 350000);
    await Promise.all([1, 2, 3].map(() => call(payWebhook, "POST", { raw, headers })));
    const again = await call(payWebhook, "POST", { raw, headers });
    expect(again.json.data.outcome).toBe("duplicate");
    expect(sendieeCalls()).toHaveLength(1);
  });

  it("refuses to mark paid when the amount doesn't match", async () => {
    const { payment } = await pendingPayment();
    const { raw, headers } = linkPaid(payment.paymentOrderId, 100);
    const { json } = await call(payWebhook, "POST", { raw, headers });
    expect(json.data.outcome).toBe("amount_mismatch");
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
  });

  it("does not let a late cancel undo a payment", async () => {
    const { payment } = await pendingPayment();
    const paid = linkPaid(payment.paymentOrderId, 350000);
    await call(payWebhook, "POST", { raw: paid.raw, headers: paid.headers });
    const raw = JSON.stringify({ event: "payment_link.expired", payload: { payment_link: { entity: { id: payment.paymentOrderId } } } });
    await call(payWebhook, "POST", { raw, headers: { "x-razorpay-signature": razorpaySignature(raw), "x-razorpay-event-id": "evt_2" } });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID");
  });

  it("locks the bill once paid", async () => {
    const { job, payment } = await pendingPayment();
    const paid = linkPaid(payment.paymentOrderId, 350000);
    await call(payWebhook, "POST", { raw: paid.raw, headers: paid.headers });
    const add = await call(addItemRoute, "POST", { cookie, params: { id: job.id }, body: item() });
    expect(add.status).toBe(409);
    const pay = await call(createPayment, "POST", { cookie, body: { serviceJobId: job.id } });
    expect(pay.json.error.code).toBe("SERVICE_ALREADY_PAID");
  });

  it("verifies Stripe signatures too, including replay protection", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const raw = '{"id":"evt"}';
    const t = Math.floor(Date.now() / 1000);
    const sign = (ts: number) => createHmac("sha256", "whsec_test").update(`${ts}.${raw}`).digest("hex");
    const headers = (ts: number, sig: string) => ({ get: () => `t=${ts},v1=${sig}` });
    expect(stripe.verifyWebhook(raw, headers(t, sign(t)))).toBe(true);
    expect(stripe.verifyWebhook(raw, headers(t, "bad"))).toBe(false);
    expect(stripe.verifyWebhook(raw, headers(t - 1000, sign(t - 1000)))).toBe(false);
  });
});
