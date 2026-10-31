import { beforeEach, describe, expect, it } from "vitest";
import { POST as assign } from "@/app/api/service-jobs/[id]/assign/route";
import { GET as getJob } from "@/app/api/service-jobs/[id]/route";
import { GET as listJobs } from "@/app/api/service-jobs/route";
import { POST as status } from "@/app/api/service-jobs/[id]/status/route";
import { GET as workers } from "@/app/api/workers/route";
import { db } from "@/lib/db";
import { fake, call, loginCookie, makeJob, makeUser, openWindow, sendieeCalls } from "./helpers";

let admin: string, reception: string, raj: string, kumar: string;
let rajId: string, kumarId: string;

beforeEach(async () => {
  admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
  reception = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
  const r = await makeUser("WORKER", "Raj");
  const k = await makeUser("WORKER", "Kumar");
  rajId = r.id;
  kumarId = k.id;
  raj = await loginCookie(r.email);
  kumar = await loginCookie(k.email);
});

const setStatus = (cookie: string, id: string, next: string, extra: object = {}) =>
  call(status, "POST", { cookie, params: { id }, body: { status: next, ...extra } });

describe("worker assignment", () => {
  it("assigns, moves NEW to ASSIGNED, records history and audit, notifies the customer", async () => {
    const { job, customer } = await makeJob();
    await openWindow(customer.id);
    const { status: code } = await call(assign, "POST", { cookie: reception, params: { id: job.id }, body: { workerId: rajId } });
    expect(code).toBe(200);
    const row = await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ assignedWorkerId: rajId, status: "ASSIGNED" });
    expect(await db.serviceStatusHistory.count({ where: { serviceJobId: job.id, newStatus: "ASSIGNED" } })).toBe(1);
    expect(await db.activityLog.count({ where: { action: "SERVICE_ASSIGNED", entityId: job.id } })).toBe(1);
    expect(sendieeCalls()).toHaveLength(1);
  });

  it("reassigns without changing status or re-notifying the customer", async () => {
    const { job } = await makeJob();
    await call(assign, "POST", { cookie: reception, params: { id: job.id }, body: { workerId: rajId } });
    fake.calls = [];
    await call(assign, "POST", { cookie: reception, params: { id: job.id }, body: { workerId: kumarId } });
    const row = await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ assignedWorkerId: kumarId, status: "ASSIGNED" });
    expect(sendieeCalls()).toHaveLength(0);
    expect(await db.activityLog.count({ where: { action: "SERVICE_REASSIGNED" } })).toBe(1);
  });

  it("refuses non-workers and workers cannot assign", async () => {
    const { job } = await makeJob();
    const admins = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    expect((await call(assign, "POST", { cookie: reception, params: { id: job.id }, body: { workerId: admins.id } })).status).toBe(400);
    expect((await call(assign, "POST", { cookie: raj, params: { id: job.id }, body: { workerId: rajId } })).status).toBe(403);
  });

  it("lists workers with their active job counts", async () => {
    const { job } = await makeJob();
    await call(assign, "POST", { cookie: reception, params: { id: job.id }, body: { workerId: rajId } });
    const { json } = await call(workers, "GET", { cookie: reception });
    expect(json.data.find((w: any) => w.name === "Raj").activeJobs).toBe(1);
    expect(json.data.find((w: any) => w.name === "Kumar").activeJobs).toBe(0);
  });
});

describe("worker permissions", () => {
  it("shows a worker only their own jobs and hides others as 404", async () => {
    const { job } = await makeJob();
    await call(assign, "POST", { cookie: reception, params: { id: job.id }, body: { workerId: rajId } });

    const mine = await call(listJobs, "GET", { cookie: raj });
    expect(mine.json.data.map((j: any) => j.id)).toEqual([job.id]);
    expect((await call(getJob, "GET", { cookie: raj, params: { id: job.id } })).status).toBe(200);

    const theirs = await call(listJobs, "GET", { cookie: kumar });
    expect(theirs.json.data).toEqual([]);
    expect((await call(getJob, "GET", { cookie: kumar, params: { id: job.id } })).status).toBe(404);
  });

  it("stops a worker changing another worker's job", async () => {
    const { job } = await makeJob();
    await call(assign, "POST", { cookie: reception, params: { id: job.id }, body: { workerId: rajId } });
    const { status: code } = await setStatus(kumar, job.id, "VEHICLE_RECEIVED");
    expect(code).toBe(404);
    expect((await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ASSIGNED");
  });
});

describe("status transitions", () => {
  async function assigned() {
    const ctx = await makeJob();
    await call(assign, "POST", { cookie: reception, params: { id: ctx.job.id }, body: { workerId: rajId } });
    return ctx;
  }

  it("walks the full happy path including the parts loop, recording each step", async () => {
    const { job } = await assigned();
    for (const s of ["VEHICLE_RECEIVED", "INSPECTION", "SERVICE_IN_PROGRESS", "WAITING_FOR_PARTS", "SERVICE_IN_PROGRESS", "READY_FOR_DELIVERY", "COMPLETED"]) {
      expect((await setStatus(raj, job.id, s)).status, s).toBe(200);
    }
    const row = await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("COMPLETED");
    expect(row.actualCompletion).not.toBeNull();
    const history = await db.serviceStatusHistory.findMany({ where: { serviceJobId: job.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.newStatus)).toEqual(["NEW", "ASSIGNED", "VEHICLE_RECEIVED", "INSPECTION", "SERVICE_IN_PROGRESS", "WAITING_FOR_PARTS", "SERVICE_IN_PROGRESS", "READY_FOR_DELIVERY", "COMPLETED"]);
    expect(history.at(-1)).toMatchObject({ oldStatus: "READY_FOR_DELIVERY", changedByRole: "WORKER", changedById: rajId });
  });

  it("rejects skipping steps and leaves no trace", async () => {
    const { job } = await assigned();
    const before = await db.serviceStatusHistory.count({ where: { serviceJobId: job.id } });
    const { status: code, json } = await setStatus(raj, job.id, "COMPLETED");
    expect(code).toBe(422);
    expect(json.error.code).toBe("INVALID_STATUS_TRANSITION");
    expect(await db.serviceStatusHistory.count({ where: { serviceJobId: job.id } })).toBe(before);
  });

  it("does not let workers cancel, override or use ASSIGNED", async () => {
    const { job } = await assigned();
    expect((await setStatus(raj, job.id, "CANCELLED")).status).toBe(422);
    expect((await setStatus(raj, job.id, "COMPLETED", { override: true, notes: "x" })).status).toBe(403);
  });

  it("lets a receptionist cancel but not progress a job", async () => {
    const { job } = await assigned();
    expect((await setStatus(reception, job.id, "VEHICLE_RECEIVED")).status).toBe(403);
    expect((await setStatus(reception, job.id, "CANCELLED")).status).toBe(200);
    expect((await setStatus(reception, job.id, "CANCELLED")).status).toBe(409);
  });

  it("only lets an admin override, requires a reason, and logs it", async () => {
    const { job } = await assigned();
    expect((await setStatus(admin, job.id, "COMPLETED")).status).toBe(422);
    expect((await setStatus(admin, job.id, "COMPLETED", { override: true })).status).toBe(400);
    expect((await setStatus(admin, job.id, "COMPLETED", { override: true, notes: "Customer collected early" })).status).toBe(200);
    const history = await db.serviceStatusHistory.findFirstOrThrow({ where: { serviceJobId: job.id, newStatus: "COMPLETED" } });
    expect(history).toMatchObject({ isOverride: true, notes: "Customer collected early", changedByRole: "ADMIN" });
    expect(await db.activityLog.count({ where: { action: "STATUS_OVERRIDE", entityId: job.id } })).toBe(1);
  });

  it("lets only one of two simultaneous clicks win", async () => {
    const { job } = await assigned();
    const results = await Promise.all([setStatus(raj, job.id, "VEHICLE_RECEIVED"), setStatus(raj, job.id, "VEHICLE_RECEIVED")]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await db.serviceStatusHistory.count({ where: { serviceJobId: job.id, newStatus: "VEHICLE_RECEIVED" } })).toBe(1);
  });

  it("keeps the status change when WhatsApp is down", async () => {
    const { job } = await assigned();
    fake.fail = { status: 500, code: "MESSAGE_SEND_FAILED" };
    const { status: code } = await setStatus(raj, job.id, "VEHICLE_RECEIVED");
    expect(code).toBe(200);
    expect((await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("VEHICLE_RECEIVED");
    expect(await db.notification.count({ where: { status: "FAILED" } })).toBe(1);
  });
});
