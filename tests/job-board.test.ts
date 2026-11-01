import type { ServiceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { POST as assign } from "@/app/api/service-jobs/[id]/assign/route";
import { PATCH as editJob } from "@/app/api/service-jobs/[id]/route";
import { POST as status } from "@/app/api/service-jobs/[id]/status/route";
import { db } from "@/lib/db";
import { assertStatusChangeAllowed } from "@/lib/services/jobs";
import { boardTargets, STATUSES } from "@/lib/status";
import { call, loginCookie, makeJob, makeUser } from "./helpers";

describe("board move rules", () => {
  for (const role of ["ADMIN", "RECEPTIONIST"] as const) {
    it(`offers ${role} only moves the server accepts`, () => {
      const user = { id: "staff", role };
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          const offered = boardTargets(from).includes(to);
          const check = () => assertStatusChangeAllowed(user, { status: from, assignedWorkerId: null }, to, false);
          if (offered) expect(check, `${from} -> ${to}`).not.toThrow();
          else expect(check, `${from} -> ${to}`).toThrow();
        }
      }
    });
  }
});

describe("moving a card", () => {
  const move = (cookie: string, id: string, to: ServiceStatus) =>
    call(status, "POST", { cookie, params: { id }, body: { status: to } });

  it("lets an admin move a job one step and records it", async () => {
    const cookie = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const { job } = await makeJob();
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "ASSIGNED" } });
    expect((await move(cookie, job.id, "VEHICLE_RECEIVED")).status).toBe(200);
    expect((await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("VEHICLE_RECEIVED");
    expect(await db.serviceStatusHistory.count({ where: { serviceJobId: job.id, newStatus: "VEHICLE_RECEIVED" } })).toBe(1);
  });

  it("lets a receptionist move a job to any open stage, but not reopen a closed one", async () => {
    const cookie = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    const { job } = await makeJob();
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "ASSIGNED" } });
    expect((await move(cookie, job.id, "READY_FOR_DELIVERY")).status).toBe(200);
    expect((await move(cookie, job.id, "INSPECTION")).status).toBe(200);
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
    expect((await move(cookie, job.id, "INSPECTION")).status).toBe(422);
  });
});

describe("editing and assigning from a card", () => {
  const edits = { serviceType: "Car Wash", customerComplaint: "Muddy", internalNotes: "", estimatedAmount: "500", priority: "HIGH", appointmentDate: "", expectedCompletion: "" };

  for (const role of ["ADMIN", "RECEPTIONIST"] as const) {
    it(`lets ${role} edit a job and assign a worker`, async () => {
      const cookie = await loginCookie((await makeUser(role, "Staff")).email);
      const worker = await makeUser("WORKER", "Raj");
      const { job } = await makeJob();
      expect((await call(editJob, "PATCH", { cookie, params: { id: job.id }, body: edits })).status).toBe(200);
      expect((await call(assign, "POST", { cookie, params: { id: job.id }, body: { workerId: worker.id } })).status).toBe(200);
      const row = await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(row).toMatchObject({ serviceType: "Car Wash", priority: "HIGH", assignedWorkerId: worker.id, status: "ASSIGNED" });
      expect(Number(row.estimatedAmount)).toBe(500);
    });
  }

  it("refuses a worker doing either", async () => {
    const worker = await makeUser("WORKER", "Raj");
    const cookie = await loginCookie(worker.email);
    const { job } = await makeJob();
    expect((await call(editJob, "PATCH", { cookie, params: { id: job.id }, body: edits })).status).toBe(403);
    expect((await call(assign, "POST", { cookie, params: { id: job.id }, body: { workerId: worker.id } })).status).toBe(403);
  });
});
