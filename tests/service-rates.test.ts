import { beforeEach, describe, expect, it } from "vitest";
import { POST as decide } from "@/app/api/service-types/[id]/rate/decision/route";
import { POST as setRate } from "@/app/api/service-types/[id]/rate/route";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { db } from "@/lib/db";
import { billPrices } from "@/lib/services/service-rates";
import { createJob } from "@/lib/services/jobs";
import { replyForMessage } from "@/lib/services/whatsapp-commands";
import { call, loginCookie, makeCustomer, makeUser, makeVehicle } from "./helpers";

describe("service rates", () => {
  let admin: string, reception: string, worker: string, id: string;
  const NAME = "Test Wash";

  beforeEach(async () => {
    admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    reception = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    worker = await loginCookie((await makeUser("WORKER", "Raj")).email);
    id = (await db.serviceType.create({ data: { name: NAME, rate: 300 } })).id;
  });
  const row = () => db.serviceType.findUniqueOrThrow({ where: { id } });
  const propose = (cookie: string, rate: number) => call(setRate, "POST", { cookie, params: { id }, body: { rate } });

  it("applies an admin's rate at once", async () => {
    expect((await propose(admin, 450)).status).toBe(200);
    expect(Number((await row()).rate)).toBe(450);
  });

  for (const who of ["reception", "worker"] as const) {
    it(`holds a change from ${who} until an admin approves`, async () => {
      expect((await propose(who === "reception" ? reception : worker, 500)).status).toBe(200);
      let t = await row();
      expect(Number(t.rate)).toBe(300);
      expect(Number(t.proposedRate)).toBe(500);
      expect((await billPrices())[NAME]).toBe(300);
      expect((await call(decide, "POST", { cookie: admin, params: { id }, body: { approve: true, proposedRate: 500 } })).status).toBe(200);
      t = await row();
      expect(Number(t.rate)).toBe(500);
      expect(t.proposedRate).toBeNull();
    });
  }

  it("keeps the old rate when the admin rejects, and only admins can decide", async () => {
    await propose(worker, 500);
    for (const cookie of [reception, worker]) {
      expect((await call(decide, "POST", { cookie, params: { id }, body: { approve: true, proposedRate: 500 } })).status).toBe(403);
    }
    expect((await call(decide, "POST", { cookie: admin, params: { id }, body: { approve: false, proposedRate: 500 } })).status).toBe(200);
    const t = await row();
    expect(Number(t.rate)).toBe(300);
    expect(t.proposedRate).toBeNull();
    expect((await call(decide, "POST", { cookie: admin, params: { id }, body: { approve: true, proposedRate: 500 } })).status).toBe(409);
  });

  it("gives a new enquiry the default price, unless one is quoted", async () => {
    const customer = await makeCustomer();
    const vehicle = await makeVehicle(customer.id);
    const base = { customerId: customer.id, vehicleId: vehicle.id, serviceType: NAME, appointmentDate: null, expectedCompletion: null, customerComplaint: null, internalNotes: null };
    const blank = await createJob(SYSTEM_ACTOR, { ...base, estimatedAmount: null });
    expect(Number(blank.estimatedAmount)).toBe(300);
    await db.serviceJob.update({ where: { id: blank.id }, data: { status: "CANCELLED" } });
    const quoted = await createJob(SYSTEM_ACTOR, { ...base, estimatedAmount: 999 });
    expect(Number(quoted.estimatedAmount)).toBe(999);
  });

  it("answers a price question from someone with no job", async () => {
    const customer = await makeCustomer("919111111111", "Enquirer");
    const reply = await replyForMessage(customer, "how much for a wash?");
    expect(reply?.reply).toContain("Test Wash");
    expect(reply?.reply).toContain("300");
  });
});
