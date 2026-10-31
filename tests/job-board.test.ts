import type { ServiceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
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
          const offered = boardTargets(role, from).includes(to);
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

  it("refuses a receptionist moving a job forward", async () => {
    const cookie = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    const { job } = await makeJob();
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "ASSIGNED" } });
    expect((await move(cookie, job.id, "VEHICLE_RECEIVED")).status).toBe(403);
  });
});
