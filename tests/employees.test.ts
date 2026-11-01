import { existsSync } from "node:fs";
import bcrypt from "bcryptjs";
import { type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/employees/route";
import { GET as reportRoute } from "@/app/api/employees/report/route";
import { PATCH as profilePatch } from "@/app/api/users/[id]/profile/route";
import { GET as usersGet, POST as usersPost } from "@/app/api/users/route";
import { DELETE as userDelete, PATCH as userPatch } from "@/app/api/users/[id]/route";
import { GET as workersGet } from "@/app/api/workers/route";
import { GET as drilldownRoute } from "@/app/api/reports/drilldown/route";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { userFromToken } from "@/lib/auth/session";
import { db, lockUserRow } from "@/lib/db";
import { addDayKey, dayKeyToDate, istDayKey, monthRangeIST, workerLoadLabel } from "@/lib/format";
import { roleHome } from "@/lib/permissions";
import { teamMonthSummaries } from "@/lib/services/attendance";
import { employeeReportCsv, listEmployees } from "@/lib/services/employees";
import { assignWorker, changeStatus, createJob, workersWithLoad } from "@/lib/services/jobs";
import { chartData, exportCsv } from "@/lib/services/reports";
import { receptionPerformance, workerPerformance } from "@/lib/services/staff";
import { call, loginCookie, makeCustomer, makeJob, makeUser, makeVehicle, PASSWORD, request } from "./helpers";

const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; email: string; phone: string | null; role: Role } }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/",
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

const { default: EmployeesPage } = await import("@/app/admin/employees/page");
const { default: WorkersPage } = await import("@/app/admin/workers/page");
const { default: ReceptionistsPage } = await import("@/app/admin/receptionists/page");
const { default: StaffPage } = await import("@/app/admin/staff/[id]/page");
const { formValues } = await import("@/components/actions");
const { EditEmployee } = await import("@/components/employees-view");
const { employeeEditFields } = await import("@/components/forms-config");

async function html(element: ReactElement) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
}

const SALARY = "51515.50";

let admin: string, workerCookie: string, receptionCookie: string;
let adminUser: Awaited<ReturnType<typeof makeUser>>, worker: Awaited<ReturnType<typeof makeUser>>, reception: Awaited<ReturnType<typeof makeUser>>;

beforeEach(async () => {
  adminUser = await makeUser("ADMIN", "Boss");
  worker = await makeUser("WORKER", "Raj");
  reception = await makeUser("RECEPTIONIST", "Rita");
  await db.user.update({ where: { id: worker.id }, data: { salary: SALARY, jobTitle: "Mechanic", phone: "9876543210", joinedOn: dayKeyToDate("2026-01-01") } });
  await db.user.update({ where: { id: reception.id }, data: { salary: "20000", joinedOn: dayKeyToDate("2026-01-01") } });
  admin = await loginCookie("boss@test.local");
  workerCookie = await loginCookie("raj@test.local");
  receptionCookie = await loginCookie("rita@test.local");
  session.user = adminUser;
});

afterEach(() => {
  vi.useRealTimers();
});

async function activeJobFor(workerId: string) {
  const { job } = await makeJob();
  await assignWorker(SYSTEM_ACTOR, job.id, workerId);
  return job;
}

const patch = (id: string, body: unknown) => call(profilePatch, "PATCH", { cookie: admin, params: { id }, body });
const roleOf = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).role;

describe("changing someone's role", () => {
  it("moves a worker with no active jobs to reception and back", async () => {
    expect((await patch(worker.id, { role: "RECEPTIONIST" })).status).toBe(200);
    expect(await roleOf(worker.id)).toBe("RECEPTIONIST");
    expect((await patch(worker.id, { role: "WORKER" })).status).toBe(200);
    expect(await roleOf(worker.id)).toBe("WORKER");
  });

  it("refuses a worker with active jobs and says to reassign first", async () => {
    await activeJobFor(worker.id);
    const res = await patch(worker.id, { role: "RECEPTIONIST" });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("WORKER_HAS_ACTIVE_JOBS");
    expect(res.json.error.message).toMatch(/Reassign .*1 active job.* first/);
    expect(await roleOf(worker.id)).toBe("WORKER");
  });

  it("refuses the old user route too, so the rule can't be walked around", async () => {
    await activeJobFor(worker.id);
    const res = await call(userPatch, "PATCH", { cookie: admin, params: { id: worker.id }, body: { role: "RECEPTIONIST" } });
    expect(res.status).toBe(409);
    expect(await roleOf(worker.id)).toBe("WORKER");
  });

  it("lets a completed job stay behind, and still saves other edits for a busy worker", async () => {
    const job = await activeJobFor(worker.id);
    expect((await patch(worker.id, { role: "WORKER", jobTitle: "Lead" })).status).toBe(200);
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "COMPLETED", actualCompletion: new Date() } });
    expect((await patch(worker.id, { role: "RECEPTIONIST" })).status).toBe(200);
  });

  it("nobody can be made an admin, by any route", async () => {
    expect((await patch(worker.id, { role: "ADMIN" })).status).toBe(400);
    const viaUser = await call(userPatch, "PATCH", { cookie: admin, params: { id: worker.id }, body: { role: "ADMIN" } });
    expect(viaUser.status).toBe(400);
    expect(viaUser.json.error.code).toBe("ROLE_NOT_ALLOWED");
    expect(await roleOf(worker.id)).toBe("WORKER");
    const body = { name: "New", email: "new@test.local", password: PASSWORD, role: "ADMIN" };
    expect((await call(createRoute, "POST", { cookie: admin, body })).status).toBe(400);
    expect((await call(usersPost, "POST", { cookie: admin, body })).status).toBe(400);
    expect(await db.user.count({ where: { email: "new@test.local" } })).toBe(0);
  });

  it("an admin can't be changed from here, and can't demote themselves", async () => {
    const other = await makeUser("ADMIN", "Other");
    expect((await patch(other.id, { role: "WORKER" })).status).toBe(404);
    expect((await patch(adminUser.id, { role: "WORKER" })).status).toBe(404);
    const viaUser = await call(userPatch, "PATCH", { cookie: admin, params: { id: other.id }, body: { role: "RECEPTIONIST" } });
    expect(viaUser.json.error.code).toBe("ROLE_NOT_ALLOWED");
    const self = await call(userPatch, "PATCH", { cookie: admin, params: { id: adminUser.id }, body: { role: "WORKER" } });
    expect(self.json.error.code).toBe("CANNOT_CHANGE_SELF");
    expect(await roleOf(other.id)).toBe("ADMIN");
    expect(await roleOf(adminUser.id)).toBe("ADMIN");
  });

  it("takes effect on the very next request and at the next login", async () => {
    expect((await call(listRoute, "GET", { cookie: workerCookie })).status).toBe(403);
    await patch(worker.id, { role: "RECEPTIONIST" });
    const token = workerCookie.split("=")[1];
    expect((await userFromToken(token))?.role).toBe("RECEPTIONIST");
    const res = await login(request("POST", "/api/auth/login", { body: { email: "raj@test.local", password: PASSWORD } }));
    expect(((await res.json()) as any).data.redirectTo).toBe(roleHome.RECEPTIONIST);
    // The old session now counts as reception: it can list workers, and no job can be assigned to it.
    expect((await call(workersGet, "GET", { cookie: workerCookie })).status).toBe(200);
    const { job } = await makeJob();
    await expect(assignWorker(SYSTEM_ACTOR, job.id, worker.id)).rejects.toThrow("Select an active worker");
  });

  it("re-points the notifications they already have", async () => {
    await db.staffNotification.create({ data: { userId: worker.id, title: "t", body: "b", link: "/worker/service-rates" } });
    await patch(worker.id, { role: "RECEPTIONIST" });
    expect((await db.staffNotification.findFirstOrThrow({ where: { userId: worker.id } })).link).toBe("/reception/service-rates");
  });

  it("records the change without carrying salary", async () => {
    await patch(worker.id, { role: "RECEPTIONIST", salary: "1234.00" });
    const log = await db.activityLog.findFirstOrThrow({ where: { action: "STAFF_PROFILE_UPDATED", entityId: worker.id } });
    expect(log.summary).toContain("now a receptionist");
    expect(JSON.stringify(log)).not.toContain("1234");
  });
});

describe("a role change racing a job being given out", () => {
  /** Runs `during` while the save is hashing its password, after its first check has passed. */
  function duringPasswordHash(during: () => Promise<unknown>) {
    const hash = bcrypt.hash.bind(bcrypt) as (s: string, salt: number) => Promise<string>;
    return vi.spyOn(bcrypt, "hash").mockImplementationOnce((async (s: string, salt: number) => {
      await during();
      return hash(s, salt);
    }) as never);
  }

  it("the profile route rolls back if a job landed during the password hash", async () => {
    const { job } = await makeJob();
    const spy = duringPasswordHash(() => assignWorker(SYSTEM_ACTOR, job.id, worker.id));
    const res = await patch(worker.id, { role: "RECEPTIONIST", password: "NewPassword1!" });
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("WORKER_HAS_ACTIVE_JOBS");
    expect(await roleOf(worker.id)).toBe("WORKER");
    // Rolled back whole: the password didn't change either.
    expect((await login(request("POST", "/api/auth/login", { body: { email: "raj@test.local", password: PASSWORD } }))).status).toBe(200);
  });

  it("the old user route and deactivation roll back the same way", async () => {
    const { job } = await makeJob();
    const spy = duringPasswordHash(() => assignWorker(SYSTEM_ACTOR, job.id, worker.id));
    const res = await call(userPatch, "PATCH", { cookie: admin, params: { id: worker.id }, body: { active: false, password: "NewPassword1!" } });
    spy.mockRestore();
    expect(res.json.error.code).toBe("WORKER_HAS_ACTIVE_JOBS");
    expect((await db.user.findUniqueOrThrow({ where: { id: worker.id } })).active).toBe(true);
    expect(await db.staffInactivePeriod.count({ where: { userId: worker.id } })).toBe(0);
  });

  it("an assignment that already read the old role waits, then is refused", async () => {
    const { job } = await makeJob();
    let assign!: Promise<unknown>;
    await db.$transaction(async (tx) => {
      await lockUserRow(tx, worker.id);
      assign = assignWorker(SYSTEM_ACTOR, job.id, worker.id).then(() => "assigned", (err: Error) => err.message);
      // Commit the role change only once the assignment is stuck on the lock, past its first read.
      for (let tries = 0; tries < 100; tries++) {
        const [{ waiting }] = await db.$queryRaw<{ waiting: bigint }[]>`SELECT count(*) AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`;
        if (waiting > 0) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await tx.user.update({ where: { id: worker.id }, data: { role: "RECEPTIONIST" } });
    });
    expect(await assign).toBe("Select an active worker");
    expect((await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).assignedWorkerId).toBeNull();
  });
});

describe("reopening a closed job", () => {
  const closedJob = async () => {
    const job = await activeJobFor(worker.id);
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "COMPLETED", actualCompletion: new Date() } });
    return job;
  };
  const reopen = (id: string, notes = "Customer came back") => changeStatus(adminUser, SYSTEM_ACTOR, id, { status: "SERVICE_IN_PROGRESS", override: true, notes });

  it("sends it back to New when its worker has moved to reception, and it can then be assigned", async () => {
    const job = await closedJob();
    expect((await patch(worker.id, { role: "RECEPTIONIST" })).status).toBe(200);
    const after = await reopen(job.id);
    expect([after.status, after.assignedWorkerId, after.actualCompletion]).toEqual(["NEW", null, null]);
    const history = await db.serviceStatusHistory.findFirstOrThrow({ where: { serviceJobId: job.id, isOverride: true } });
    expect(history.newStatus).toBe("NEW");
    expect(history.notes).toContain("Customer came back");
    expect(history.notes).toContain("Raj is no longer an active worker");
    const other = await makeUser("WORKER", "Sam");
    expect((await assignWorker(SYSTEM_ACTOR, job.id, other.id)).status).toBe("ASSIGNED");
  });

  it("does the same when its worker was deactivated", async () => {
    const job = await closedJob();
    expect((await patch(worker.id, { active: false })).status).toBe(200);
    expect((await reopen(job.id)).assignedWorkerId).toBeNull();
  });

  it("keeps the worker and the status asked for when they're still a worker", async () => {
    const job = await closedJob();
    const after = await reopen(job.id);
    expect([after.status, after.assignedWorkerId]).toEqual(["SERVICE_IN_PROGRESS", worker.id]);
    const history = await db.serviceStatusHistory.findFirstOrThrow({ where: { serviceJobId: job.id, isOverride: true } });
    expect(history.notes).toBe("Customer came back");
  });
});

describe("the edit forms", () => {
  const formOf = (values: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(values)) form.set(k, v);
    return form;
  };
  // What a page shows for Raj, and what the browser submits for it untouched.
  const shown = { role: "WORKER", name: "Raj", phone: "9876543210", email: "raj@test.local", jobTitle: "Mechanic", salary: SALARY, joinedOn: "2026-01-01", active: "on", password: "" };
  const initial = { role: "WORKER", name: "Raj", phone: "9876543210", email: "raj@test.local", jobTitle: "Mechanic", salary: SALARY, joinedOn: "2026-01-01", active: true };

  it("send only the field that was edited", () => {
    expect(formValues(employeeEditFields, formOf(shown), initial)).toEqual({});
    expect(formValues(employeeEditFields, formOf({ ...shown, phone: "9000000009" }), initial)).toEqual({ phone: "9000000009" });
    expect(formValues(employeeEditFields, formOf({ ...shown, password: "NewPassword1!" }), initial)).toEqual({ password: "NewPassword1!" });
    const { active: _unticked, ...noActive } = shown;
    expect(formValues(employeeEditFields, formOf(noActive), initial)).toEqual({ active: false });
  });

  it("treat a blank optional field as unchanged, and can still clear one", () => {
    const blank = { ...initial, jobTitle: null, phone: null };
    expect(formValues(employeeEditFields, formOf({ ...shown, jobTitle: "", phone: "" }), blank)).toEqual({});
    expect(formValues(employeeEditFields, formOf({ ...shown, jobTitle: "" }), initial)).toEqual({ jobTitle: "" });
  });

  it("still send everything without initial values to compare, as other forms do", () => {
    expect(formValues(employeeEditFields, formOf(shown))).toMatchObject({ role: "WORKER", active: true, phone: "9876543210" });
  });

  it("a phone fix from a stale page leaves someone deactivated and in their new role", async () => {
    expect((await patch(worker.id, { role: "RECEPTIONIST", active: false })).status).toBe(200);
    const body = formValues(employeeEditFields, formOf({ ...shown, phone: "9000000009" }), initial);
    expect((await patch(worker.id, body)).status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: worker.id } });
    expect([row.phone, row.role, row.active]).toEqual(["9000000009", "RECEPTIONIST", false]);
  });

  it("are switched on for the pencil and the profile", async () => {
    const [e] = await listEmployees({ id: worker.id });
    expect((EditEmployee({ e }).props as { onlyChanged?: boolean }).onlyChanged).toBe(true);
    const page = (await StaffPage({ params: Promise.resolve({ id: worker.id }) })) as ReactElement<{ children: ReactElement<{ children: ReactElement<{ onlyChanged?: boolean }> }>[] }>;
    expect(page.props.children[0].props.children.props.onlyChanged).toBe(true);
  });
});

describe("someone who joins on a future date", () => {
  const today = istDayKey(new Date());
  const joined = (id: string, day: string) => db.user.update({ where: { id }, data: { joinedOn: dayKeyToDate(day) } });
  const book = async (appointmentDate: Date | null = null) => {
    const customer = await makeCustomer("919000000077", "Booker");
    const vehicle = await makeVehicle(customer.id, "TN01ZZ0077");
    return createJob(SYSTEM_ACTOR, { customerId: customer.id, vehicleId: vehicle.id, serviceType: "Wash", customerComplaint: null, internalNotes: null, estimatedAmount: 1000, appointmentDate, expectedCompletion: null });
  };
  const autoAssignOn = () => db.setting.create({ data: { key: "auto_assign_enabled", value: "true" } });

  it("isn't auto-assigned first, though they have the fewest jobs", async () => {
    await activeJobFor(worker.id);
    await autoAssignOn();
    const newcomer = await makeUser("WORKER", "Aaron");
    await joined(newcomer.id, addDayKey(today, 7));
    expect((await book()).assignedWorkerId).toBe(worker.id);
  });

  it("leaves the job unassigned if nobody else is in", async () => {
    await autoAssignOn();
    await joined(worker.id, addDayKey(today, 7));
    expect((await book()).assignedWorkerId).toBeNull();
  });

  it("can take a booking from their first day on", async () => {
    await autoAssignOn();
    const start = addDayKey(today, 7);
    await joined(worker.id, start);
    const onDayOne = await book(new Date(`${start}T10:00:00+05:30`));
    expect(onDayOne.assignedWorkerId).toBe(worker.id);
  });

  it("starts being offered on the day they join, and the dropdown says when", async () => {
    const start = addDayKey(today, 7);
    await joined(worker.id, start);
    const raj = (await workersWithLoad()).find((w) => w.id === worker.id)!;
    expect(raj.startsOn).toBe(start);
    expect(workerLoadLabel({ ...raj, startsOn: "2026-11-09" })).toBe("Raj (starts 9 Nov 2026)");
    expect((await workersWithLoad(start)).find((w) => w.id === worker.id)!.startsOn).toBeNull();
    await joined(worker.id, today);
    expect((await workersWithLoad()).find((w) => w.id === worker.id)!.startsOn).toBeNull();
  });
});

describe("the reports after a role change", () => {
  async function movedWorker() {
    const job = await activeJobFor(worker.id);
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "COMPLETED", actualCompletion: new Date() } });
    expect((await patch(worker.id, { role: "RECEPTIONIST" })).status).toBe(200);
    return job;
  }

  it("keeps their row on the chart and in the CSV", async () => {
    await movedWorker();
    expect((await chartData()).workerPerformance).toContainEqual({ name: "Raj", key: worker.id, completed: 1, active: 0 });
    expect((await exportCsv("workers"))!.split("\r\n")).toContain("Raj,1,0");
  });

  it("leaves out staff who never had a job, except workers", async () => {
    await movedWorker();
    const sam = await makeUser("WORKER", "Sam");
    const keys = (await chartData()).workerPerformance.map((w) => w.key);
    expect(keys).toContain(sam.id);
    expect(keys).not.toContain(reception.id);
    expect(keys).not.toContain(adminUser.id);
  });

  it("their bar still opens", async () => {
    const job = await movedWorker();
    const drill = (value: string) => call(drilldownRoute, "GET", { cookie: admin, path: `/api/reports/drilldown?kind=worker&value=${value}&bucket=completed` });
    const res = await drill(worker.id);
    expect(res.status).toBe(200);
    expect(res.json.data.rows.map((r: { id: string }) => r.id)).toEqual([job.id]);
    expect((await drill(reception.id)).json.error.code).toBe("WORKER_NOT_FOUND");
  });
});

describe("what the Kanban drops send", () => {
  const dropWorkers = { role: "WORKER", active: true };
  const dropReception = { role: "RECEPTIONIST", active: true };
  const dropInactive = { active: false };

  it("dragging to Inactive deactivates, under the existing rule", async () => {
    expect((await patch(reception.id, dropInactive)).status).toBe(200);
    const job = await activeJobFor(worker.id);
    expect((await patch(worker.id, dropInactive)).json.error.code).toBe("WORKER_HAS_ACTIVE_JOBS");
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
    expect((await patch(worker.id, dropInactive)).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: worker.id } })).active).toBe(false);
    expect(await db.staffInactivePeriod.count({ where: { userId: worker.id, untilDate: null } })).toBe(1);
  });

  it("dragging out of Inactive brings them back in that role", async () => {
    await patch(worker.id, dropInactive);
    expect((await patch(worker.id, dropReception)).status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: worker.id } });
    expect([row.role, row.active]).toEqual(["RECEPTIONIST", true]);
    expect(await db.staffInactivePeriod.count({ where: { userId: worker.id, untilDate: null } })).toBe(0);
    expect((await patch(worker.id, dropWorkers)).status).toBe(200);
    expect(await roleOf(worker.id)).toBe("WORKER");
  });
});

describe("adding an employee", () => {
  const body = { role: "WORKER", name: "Nila", email: "nila@test.local", phone: "9000000001", password: PASSWORD, jobTitle: "Painter", salary: "18000", joinedOn: "2026-03-05" };

  it("saves every field", async () => {
    const res = await call(createRoute, "POST", { cookie: admin, body });
    expect(res.status).toBe(201);
    expect(res.json.data.salary).toBeUndefined();
    const row = await db.user.findUniqueOrThrow({ where: { email: "nila@test.local" } });
    expect([row.role, row.jobTitle, row.salary!.toFixed(2)]).toEqual(["WORKER", "Painter", "18000.00"]);
    expect(row.joinedOn!.toISOString().slice(0, 10)).toBe("2026-03-05");
  });

  it("takes blank optional fields as the form sends them", async () => {
    const res = await call(createRoute, "POST", { cookie: admin, body: { ...body, phone: "", jobTitle: "", salary: "", joinedOn: "" } });
    expect(res.status).toBe(201);
    const row = await db.user.findUniqueOrThrow({ where: { email: "nila@test.local" } });
    expect([row.phone, row.jobTitle, row.salary, row.joinedOn]).toEqual([null, null, null, null]);
  });

  it("insists on a role", async () => {
    for (const role of [undefined, "", "MANAGER"]) {
      expect((await call(createRoute, "POST", { cookie: admin, body: { ...body, role } })).status).toBe(400);
    }
  });

  it("refuses a duplicate email and anyone but an admin", async () => {
    expect((await call(createRoute, "POST", { cookie: admin, body: { ...body, email: "raj@test.local" } })).status).toBe(409);
    expect((await call(createRoute, "POST", { cookie: receptionCookie, body })).status).toBe(403);
    expect((await call(createRoute, "POST", { cookie: workerCookie, body })).status).toBe(403);
  });
});

describe("salary stays with admins", () => {
  const readers = [
    ["employee list", listRoute, "/api/employees"],
    ["report", reportRoute, "/api/employees/report"],
  ] as const;

  it.each(readers)("the %s refuses reception, workers and strangers", async (_name, route, path) => {
    expect((await call(route, "GET", { cookie: receptionCookie, path })).status).toBe(403);
    expect((await call(route, "GET", { cookie: workerCookie, path })).status).toBe(403);
    expect((await call(route, "GET", { path })).status).toBe(401);
  });

  it("the employee list gives an admin salary but never notes or a password", async () => {
    await db.user.update({ where: { id: worker.id }, data: { staffNotes: "SECRET-NOTE" } });
    const res = await call(listRoute, "GET", { cookie: admin, path: "/api/employees" });
    const raj = res.json.data.find((e: any) => e.id === worker.id);
    expect(raj.salary).toBe(SALARY);
    const text = JSON.stringify(res.json);
    expect(text).not.toContain("SECRET-NOTE");
    expect(text).not.toContain("passwordHash");
  });

  it("the list staff can reach has none", async () => {
    const res = await call(workersGet, "GET", { cookie: receptionCookie });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).not.toContain("alary");
    expect(JSON.stringify(res.json)).not.toContain("51515");
  });

  it("the role and active routes don't send it back", async () => {
    const res = await call(userPatch, "PATCH", { cookie: admin, params: { id: worker.id }, body: { name: "Raj K" } });
    expect(JSON.stringify(res.json)).not.toContain("51515");
    expect(JSON.stringify((await call(userDelete, "DELETE", { cookie: admin, params: { id: reception.id } })).json)).not.toContain("20000");
    expect(JSON.stringify((await call(usersGet, "GET", { cookie: admin, path: "/api/users" })).json)).not.toContain("51515");
  });

  it("nobody else can change a role", async () => {
    expect((await call(profilePatch, "PATCH", { cookie: receptionCookie, params: { id: worker.id }, body: { role: "RECEPTIONIST" } })).status).toBe(403);
    expect((await call(profilePatch, "PATCH", { cookie: workerCookie, params: { id: worker.id }, body: { role: "RECEPTIONIST" } })).status).toBe(403);
  });
});

describe("the list", () => {
  it("leaves admins out", async () => {
    const names = (await listEmployees()).map((e) => e.name);
    expect(names).toEqual(["Raj", "Rita"]);
  });

  it("searches name, phone and email, in any case", async () => {
    const found = async (q: string) => (await listEmployees({ q })).map((e) => e.name);
    expect(await found("RITA")).toEqual(["Rita"]);
    expect(await found("raj@TEST")).toEqual(["Raj"]);
    expect(await found("98765 43210")).toEqual(["Raj"]);
    expect(await found("7654")).toEqual(["Raj"]);
    expect(await found("boss")).toEqual([]);
    expect(await found("nobody")).toEqual([]);
    expect(await found("  ")).toEqual(["Raj", "Rita"]);
  });

  it("finds a phone however it was saved", async () => {
    const found = async (q: string) => (await listEmployees({ q })).map((e) => e.name);
    for (const saved of ["98765 43210", "+91 98765 43210", "(98765) 43-210"]) {
      await db.user.update({ where: { id: worker.id }, data: { phone: saved } });
      expect(await found("9876543210"), saved).toEqual(["Raj"]);
      expect(await found("98765 43210"), saved).toEqual(["Raj"]);
      expect(await found("+91 98765"), saved).toEqual(saved.startsWith("+91") ? ["Raj"] : []);
    }
  });

  it("doesn't read the digits in an email or name as a phone number", async () => {
    const found = async (q: string) => (await listEmployees({ q })).map((e) => e.name);
    expect(await found("someone765@gmail.com")).toEqual([]);
    await db.user.update({ where: { id: reception.id }, data: { email: "rita765@test.local" } });
    expect(await found("rita765@test")).toEqual(["Rita"]);
    expect(await found("765")).toEqual(["Raj", "Rita"]);
  });

  it("doesn't let a phone search reach admins", async () => {
    await db.user.update({ where: { id: adminUser.id }, data: { phone: "9876543210" } });
    expect((await listEmployees({ q: "9876543210" })).map((e) => e.name)).toEqual(["Raj"]);
  });

  it("the search goes through the API too", async () => {
    const res = await call(listRoute, "GET", { cookie: admin, path: "/api/employees?q=rita" });
    expect(res.json.data.map((e: any) => e.name)).toEqual(["Rita"]);
    expect((await call(listRoute, "GET", { cookie: admin, path: "/api/employees?month=nope" })).status).toBe(400);
  });
});

describe("attendance and performance on a fixture", () => {
  // Thursday Oct 15 2026, 10:00 IST. Worked out by hand: Oct 1 to Oct 15 is 15 days, today still pending.
  const NOW = new Date("2026-10-15T04:30:00Z");
  const mark = (userId: string, day: string, status: "PRESENT" | "LEAVE") => db.attendance.create({ data: { userId, date: dayKeyToDate(day), status } });

  beforeEach(async () => {
    await mark(worker.id, "2026-10-01", "PRESENT");
    await mark(worker.id, "2026-10-02", "PRESENT");
    await mark(worker.id, "2026-10-03", "LEAVE");
    await mark(worker.id, "2026-10-15", "PRESENT");
    await mark(worker.id, "2026-09-30", "PRESENT"); // Another month.
    await mark(reception.id, "2026-10-15", "LEAVE");
    const jobs = await Promise.all([makeJobWith("9000000001", "TN01AA0001"), makeJobWith("9000000002", "TN01AA0002"), makeJobWith("9000000003", "TN01AA0003")]);
    await db.serviceJob.update({ where: { id: jobs[0] }, data: { assignedWorkerId: worker.id, status: "ASSIGNED", createdById: reception.id, createdAt: new Date("2026-10-05T10:00:00Z") } });
    await db.serviceJob.update({ where: { id: jobs[1] }, data: { assignedWorkerId: worker.id, status: "COMPLETED", actualCompletion: new Date("2026-10-10T10:00:00Z"), createdById: reception.id, createdAt: new Date("2026-10-06T10:00:00Z") } });
    await db.serviceJob.update({ where: { id: jobs[2] }, data: { assignedWorkerId: worker.id, status: "COMPLETED", actualCompletion: new Date("2026-09-10T10:00:00Z"), createdById: reception.id, createdAt: new Date("2026-09-06T10:00:00Z") } });
  });

  async function makeJobWith(phone: string, registration: string) {
    const customer = await db.customer.create({ data: { name: `C${phone}`, phone, customerCode: `C-${phone}` } });
    const vehicle = await db.vehicle.create({ data: { customerId: customer.id, registrationNumber: registration, brand: "Tata", model: "Nexon", vehicleCode: `V-${phone}` } });
    const row = await db.serviceJob.create({ data: { serviceNumber: `S-${phone}`, customerId: customer.id, vehicleId: vehicle.id, serviceType: "Wash", trackingToken: `t-${phone}` } as never });
    return row.id;
  }

  const get = async (name: string, month: string) => (await listEmployees({ month, now: NOW })).find((e) => e.name === name)!;

  it("counts this month's days", async () => {
    const raj = await get("Raj", "2026-10");
    expect([raj.attendance.present, raj.attendance.leave]).toEqual([3, 1]);
    // 15 days, 4 with records, today has one, so 11 are absent.
    expect(raj.attendance.absent).toBe(11);
    expect(raj.today).toBe("Present");
    const rita = await get("Rita", "2026-10");
    expect([rita.attendance.present, rita.attendance.leave, rita.attendance.absent]).toEqual([0, 1, 14]);
    expect(rita.today).toBe("On leave");
  });

  it("calls today Not clocked in, and isn't absent yet", async () => {
    await db.attendance.deleteMany({ where: { userId: reception.id } });
    const rita = await get("Rita", "2026-10");
    expect(rita.today).toBe("Not clocked in");
    expect(rita.attendance.absent).toBe(14);
    expect(rita.attendance.todayPending).toBe(true);
  });

  it("counts jobs only for the chosen month, but active jobs as they stand", async () => {
    const raj = await get("Raj", "2026-10");
    expect([raj.activeJobs, raj.completedInMonth]).toEqual([1, 1]);
    expect((await get("Raj", "2026-09")).completedInMonth).toBe(1);
    expect((await get("Raj", "2026-09")).activeJobs).toBe(1);
    expect((await get("Rita", "2026-10")).createdInMonth).toBe(2);
    expect((await get("Rita", "2026-09")).createdInMonth).toBe(1);
  });

  it("agrees with the figures already on the profile", async () => {
    const raj = await get("Raj", "2026-10");
    const profile = await workerPerformance(worker.id, NOW);
    expect([profile.activeJobs, profile.completedThisMonth]).toEqual([raj.activeJobs, raj.completedInMonth]);
    expect((await receptionPerformance(reception.id, NOW)).createdThisMonth).toBe((await get("Rita", "2026-10")).createdInMonth);
  });

  it("the CSV carries all of it for the chosen month", async () => {
    const lines = (await employeeReportCsv("2026-10", NOW)).split("\r\n");
    expect(lines[0]).toBe("Name,Role,Status,Job title,Email,Phone,Joined on,Monthly salary,Month,Days present,Days on leave,Days absent,Active jobs now,Jobs completed in month,Jobs created in month");
    expect(lines[1]).toBe(`Raj,Worker,Active,Mechanic,raj@test.local,9876543210,2026-01-01,${SALARY},2026-10,3,1,11,1,1,0`);
    expect(lines[2]).toBe("Rita,Receptionist,Active,,rita@test.local,,2026-01-01,20000.00,2026-10,0,1,14,0,0,2");
    expect(lines).toHaveLength(3);
    expect((await employeeReportCsv("2026-09", NOW)).split("\r\n")[1]).toContain(",2026-09,1,0,29,1,1,0");
  });

  it("leaves absent blank for someone inactive, as attendance does", async () => {
    await db.user.update({ where: { id: reception.id }, data: { active: false } });
    const line = (await employeeReportCsv("2026-10", NOW)).split("\r\n")[2];
    expect(line).toBe("Rita,Receptionist,Inactive,,rita@test.local,,2026-01-01,20000.00,2026-10,0,1,,0,0,2");
    expect((await get("Rita", "2026-10")).attendance.absent).toBeNull();
  });

  it("the team summaries haven't changed", async () => {
    const summaries = await teamMonthSummaries("2026-10");
    expect(summaries.find((s) => s.userId === worker.id)!.summary.present).toBe(3);
  });
});

describe("month boundaries in IST", () => {
  const LAST_OF_OCT_IST = new Date("2026-10-31T18:29:59Z"); // 23:59:59 IST, Oct 31
  const FIRST_OF_NOV_IST = new Date("2026-10-31T18:30:00Z"); // 00:00:00 IST, Nov 1

  it("starts each month at IST midnight", () => {
    expect(monthRangeIST("2026-11").start).toEqual(FIRST_OF_NOV_IST);
    expect(monthRangeIST("2026-10").end).toEqual(FIRST_OF_NOV_IST);
  });

  it("files a job on the IST side of midnight, though UTC still says October", async () => {
    const { job: before } = await makeJob();
    await db.serviceJob.update({ where: { id: before.id }, data: { assignedWorkerId: worker.id, status: "COMPLETED", actualCompletion: LAST_OF_OCT_IST, createdById: reception.id, createdAt: LAST_OF_OCT_IST } });
    await db.serviceJob.create({
      data: { serviceNumber: "S-AFTER", customerId: before.customerId, vehicleId: before.vehicleId, serviceType: "Wash", trackingToken: "t-after", assignedWorkerId: worker.id, status: "COMPLETED", actualCompletion: FIRST_OF_NOV_IST, createdById: reception.id, createdAt: FIRST_OF_NOV_IST } as never,
    });
    const pick = async (month: string, name: string) => (await listEmployees({ month, now: FIRST_OF_NOV_IST })).find((e) => e.name === name)!;
    expect((await pick("2026-10", "Raj")).completedInMonth).toBe(1);
    expect((await pick("2026-11", "Raj")).completedInMonth).toBe(1);
    expect((await pick("2026-10", "Rita")).createdInMonth).toBe(1);
    expect((await pick("2026-11", "Rita")).createdInMonth).toBe(1);
  });

  it("today and this month follow IST at the rollover", async () => {
    await db.attendance.create({ data: { userId: worker.id, date: dayKeyToDate("2026-10-31"), status: "PRESENT" } });
    const [oct] = await listEmployees({ now: LAST_OF_OCT_IST });
    expect([oct.month, oct.today, oct.attendance.present]).toEqual(["2026-10", "Present", 1]);
    const [nov] = await listEmployees({ now: FIRST_OF_NOV_IST });
    expect([nov.month, nov.today, nov.attendance.present]).toEqual(["2026-11", "Not clocked in", 0]);
  });
});

describe("the report download", () => {
  it("defaults to this month in IST and names the file for it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T18:30:00Z")); // 00:00 IST, Nov 1
    const cookie = await loginCookie("boss@test.local");
    const res = await call(reportRoute, "GET", { cookie, path: "/api/employees/report" });
    expect(res.status).toBe(200);
    expect(res.res.headers.get("content-type")).toContain("text/csv");
    expect(res.res.headers.get("content-disposition")).toContain("employees-2026-11.csv");
    const text = await res.res.text();
    expect(text.split("\r\n")[1]).toContain(",2026-11,");
  });

  it("takes a chosen month, and treats a blank one as this month", async () => {
    const chosen = await call(reportRoute, "GET", { cookie: admin, path: "/api/employees/report?month=2026-02" });
    expect(chosen.res.headers.get("content-disposition")).toContain("employees-2026-02.csv");
    expect((await call(reportRoute, "GET", { cookie: admin, path: "/api/employees/report?month=" })).status).toBe(200);
  });

  it.each(["2026-13", "2026-1", "nope", "0000-01", "2026-11-01"])("refuses the month %s", async (month) => {
    const res = await call(reportRoute, "GET", { cookie: admin, path: `/api/employees/report?month=${month}` });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("INVALID_MONTH");
  });

  it("includes inactive staff and leaves admins out", async () => {
    await db.user.update({ where: { id: reception.id }, data: { active: false } });
    const text = await employeeReportCsv("2026-10");
    expect(text).toContain("rita@test.local");
    expect(text).not.toContain("boss@test.local");
  });

  it("stops a name or job title running as a formula in Excel", async () => {
    await db.user.update({ where: { id: worker.id }, data: { name: "=HYPERLINK(1)", jobTitle: "@SUM(A1)", phone: "+919876543210" } });
    const text = await employeeReportCsv("2026-10");
    expect(text).toContain("'=HYPERLINK(1)");
    expect(text).toContain("'@SUM(A1)");
    expect(text).toContain("'+919876543210");
    expect(text).not.toMatch(/(^|,|\r\n)=HYPERLINK/);
  });

  it("quotes a comma so the columns stay in line", async () => {
    await db.user.update({ where: { id: worker.id }, data: { name: "Raj, Jr" } });
    expect(await employeeReportCsv("2026-10")).toContain('"Raj, Jr",Worker');
  });
});

describe("pages", () => {
  const empty = Promise.resolve({});

  it("the old addresses go to one that exists, keeping the list view", async () => {
    await expect(WorkersPage({ searchParams: empty })).rejects.toThrow("REDIRECT:/admin/employees");
    await expect(ReceptionistsPage({ searchParams: empty })).rejects.toThrow("REDIRECT:/admin/employees");
    await expect(WorkersPage({ searchParams: Promise.resolve({ view: "list" }) })).rejects.toThrow("REDIRECT:/admin/employees?view=list");
    expect(existsSync("app/admin/employees/page.tsx")).toBe(true);
    expect(existsSync("app/admin/staff/[id]/page.tsx")).toBe(true);
    expect(existsSync("components/users-view.tsx")).toBe(false);
  });

  it("the old addresses and the new one refuse anyone but an admin", async () => {
    for (const user of [worker, reception, null]) {
      session.user = user;
      await expect(EmployeesPage({ searchParams: empty })).rejects.toThrow(/^REDIRECT$/);
      await expect(WorkersPage({ searchParams: empty })).rejects.toThrow(/^REDIRECT$/);
      await expect(ReceptionistsPage({ searchParams: empty })).rejects.toThrow(/^REDIRECT$/);
    }
  });

  it("shows the three columns and everything on a card", async () => {
    await db.attendance.create({ data: { userId: worker.id, date: dayKeyToDate(new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)), status: "PRESENT" } });
    await activeJobFor(worker.id);
    await db.user.update({ where: { id: reception.id }, data: { active: false } });
    const page = await html((await EmployeesPage({ searchParams: empty })) as ReactElement);
    for (const text of ["Workers", "Reception", "Inactive", "Raj", "Mechanic", "9876543210", "Today: Present", "1 present", "1 active · 0 completed", "0 jobs created", "Download report", "+ Add employee", `/admin/staff/${worker.id}`, "Edit Raj"]) {
      expect(page, text).toContain(text);
    }
    expect(page).toMatch(/Salary: ₹51,515\.50/);
    expect(page).not.toContain("boss@test.local");
  });

  it("the list view shows the same, and search narrows it", async () => {
    const list = await html((await EmployeesPage({ searchParams: Promise.resolve({ view: "list" }) })) as ReactElement);
    for (const text of ["Monthly salary", "Performance", "Not clocked in", "Worker", "Receptionist"]) expect(list, text).toContain(text);
    const searched = await html((await EmployeesPage({ searchParams: Promise.resolve({ view: "list", q: "rita" }) })) as ReactElement);
    expect(searched).toContain("rita@test.local");
    expect(searched).not.toContain("raj@test.local");
  });

  it("the profile has role, salary, attendance and performance together, for a chosen month", async () => {
    await db.attendance.create({ data: { userId: worker.id, date: dayKeyToDate("2026-02-10"), status: "LEAVE" } });
    const page = await html((await StaffPage({ params: Promise.resolve({ id: worker.id }), searchParams: Promise.resolve({ month: "2026-02" }) })) as ReactElement);
    for (const text of ["Report, February 2026", "Monthly salary", "₹51,515.50", "Days on leave", "Active jobs now", "Jobs completed", "Back to Employees", "/admin/employees", "Performance", "Role"]) {
      expect(page, text).toContain(text);
    }
    expect(page).not.toContain("/admin/workers");
    const rita = await html((await StaffPage({ params: Promise.resolve({ id: reception.id }), searchParams: Promise.resolve({ month: "bad" }) })) as ReactElement);
    expect(rita).toContain("Jobs created");
    expect(rita).not.toContain("Report, bad");
  });
});
