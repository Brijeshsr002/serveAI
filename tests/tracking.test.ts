import { describe, expect, it } from "vitest";
import { POST as assign } from "@/app/api/service-jobs/[id]/assign/route";
import { GET as track } from "@/app/api/track/[token]/route";
import { POST as pay } from "@/app/api/track/[token]/pay/route";
import { GET as invoice } from "@/app/api/track/[token]/invoice/route";
import { POST as addItem } from "@/app/api/service-jobs/[id]/items/route";
import { db } from "@/lib/db";
import { generateInvoice } from "@/lib/services/invoices";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { call, loginCookie, makeJob, makeUser } from "./helpers";

describe("customer tracking", () => {
  it("works without login and shows the customer's own service", async () => {
    const { job } = await makeJob();
    const { status, json } = await call(track, "GET", { params: { token: job.trackingToken } });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ serviceNumber: job.serviceNumber, status: "NEW", paymentStatus: "UNPAID" });
    expect(json.data.timeline[0].status).toBe("NEW");
  });

  it("does not expose ids, internal notes or worker details", async () => {
    const reception = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    const worker = await makeUser("WORKER", "RajWorker");
    const { job, customer, vehicle } = await makeJob();
    await db.user.update({ where: { id: worker.id }, data: { phone: "919555555555" } });
    await call(assign, "POST", { cookie: reception, params: { id: job.id }, body: { workerId: worker.id } });

    const { json } = await call(track, "GET", { params: { token: job.trackingToken } });
    const text = JSON.stringify(json);
    for (const secret of ["SECRET-INTERNAL-NOTE", "RajWorker", "919555555555", job.id, customer.id, vehicle.id, worker.id, job.trackingToken]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("rejects guessed tokens, including the service number", async () => {
    const { job } = await makeJob();
    for (const token of [job.serviceNumber, job.id, "a".repeat(64), "1", ""]) {
      expect((await call(track, "GET", { params: { token } })).status, token).toBe(404);
    }
  });

  it("uses long random tokens that differ per job", async () => {
    const a = await makeJob();
    await db.serviceJob.deleteMany();
    await db.vehicle.deleteMany();
    await db.customer.deleteMany();
    const b = await makeJob();
    expect(a.job.trackingToken).not.toBe(b.job.trackingToken);
    expect(a.job.trackingToken).toHaveLength(64);
  });

  it("serves the invoice and a payment link by token, with the amount from the server", async () => {
    const cookie = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    const { job } = await makeJob();
    const params = { token: job.trackingToken };
    expect((await call(invoice, "GET", { params })).status).toBe(404);

    await call(addItem, "POST", { cookie, params: { id: job.id }, body: { itemType: "SERVICE", name: "Wash", unitPrice: 500 } });
    await generateInvoice(SYSTEM_ACTOR, job.id);

    const pdf = await call(invoice, "GET", { params });
    expect(pdf.res.headers.get("content-type")).toBe("application/pdf");

    const res = await call(pay, "POST", { params, body: { amount: 1 } });
    expect(res.json.data.paymentLink).toMatch(/^https:\/\/rzp\.io/);
    expect(Number((await db.payment.findFirstOrThrow()).amount)).toBe(500);
  });
});
