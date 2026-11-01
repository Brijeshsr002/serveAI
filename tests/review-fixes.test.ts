import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { GET as listCustomers } from "@/app/api/customers/route";
import { POST as setStatus } from "@/app/api/service-jobs/[id]/status/route";
import { POST as decide } from "@/app/api/service-types/[id]/rate/decision/route";
import { POST as setRate } from "@/app/api/service-types/[id]/rate/route";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { db } from "@/lib/db";
import { addDayKey, dayKeyToDate } from "@/lib/format";
import { LIVE_REFRESH_PAUSE, liveRefreshPaused } from "@/lib/live-refresh";
import { todayKey } from "@/lib/services/attendance";
import { createJob } from "@/lib/services/jobs";
import { activePartNames, activeServiceNames, billPrices, defaultRate, ratedServices } from "@/lib/services/service-rates";
import { PART_NAMES, UNCATALOGUED_WORK_NAMES, WORK_NAMES } from "@/lib/work-catalog";
import { call, loginCookie, makeCustomer, makeJob, makeUser, makeVehicle } from "./helpers";

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

const { default: VehiclesPage } = await import("@/app/admin/vehicles/page");
const { default: ServiceTypesPage } = await import("@/app/admin/service-types/page");
const { canDrop, DataBoard } = await import("@/components/data-board-client");
const { SimpleTable } = await import("@/components/ui-kit");

/** Every element in a server page's tree, including ones handed over as props. */
function elements(node: unknown, found: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => elements(n, found));
  else if (isValidElement(node)) {
    found.push(node as ReactElement<Record<string, unknown>>);
    Object.values(node.props as object).forEach((v) => elements(v, found));
  }
  return found;
}

describe("a worker changing a job's status", () => {
  it("doesn't get the customer's tracking token back, while staff still do", async () => {
    const w = await makeUser("WORKER", "Raj");
    const worker = await loginCookie(w.email);
    const admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const { job } = await makeJob();
    await db.serviceJob.update({ where: { id: job.id }, data: { assignedWorkerId: w.id, status: "INSPECTION" } });
    const res = await call(setStatus, "POST", { cookie: worker, params: { id: job.id }, body: { status: "SERVICE_IN_PROGRESS" } });
    expect(res.status).toBe(200);
    expect(res.json.data.status).toBe("SERVICE_IN_PROGRESS");
    expect(JSON.stringify(res.json)).not.toContain("trackingToken");
    expect(JSON.stringify(res.json)).not.toContain(job.trackingToken);
    const staff = await call(setStatus, "POST", { cookie: admin, params: { id: job.id }, body: { status: "READY_FOR_DELIVERY" } });
    expect(staff.json.data.trackingToken).toBe(job.trackingToken);
  });
});

describe("deciding a rate request", () => {
  let admin: string, worker: string, id: string;
  beforeEach(async () => {
    admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    worker = await loginCookie((await makeUser("WORKER", "Raj")).email);
    id = (await db.serviceType.create({ data: { name: "Brake Service", rate: 1000 } })).id;
  });
  const row = () => db.serviceType.findUniqueOrThrow({ where: { id } });
  const propose = (rate: number) => call(setRate, "POST", { cookie: worker, params: { id }, body: { rate } });
  const decision = (body: unknown) => call(decide, "POST", { cookie: admin, params: { id }, body });

  it("refuses an approval of an amount that has since changed, and keeps the newer request", async () => {
    await propose(1500);
    await propose(50000);
    const res = await decision({ approve: true, proposedRate: 1500 });
    expect(res.status).toBe(409);
    const t = await row();
    expect(Number(t.rate)).toBe(1000);
    expect(Number(t.proposedRate)).toBe(50000);
    expect(await db.activityLog.count({ where: { action: "SERVICE_RATE_APPROVED" } })).toBe(0);
    // Reloading shows the new amount, and that one can be decided.
    expect((await decision({ approve: true, proposedRate: "50000" })).status).toBe(200);
    expect(Number((await row()).rate)).toBe(50000);
  });

  it("refuses a rejection of an amount that has since changed", async () => {
    await propose(1500);
    await propose(150);
    expect((await decision({ approve: false, proposedRate: 1500 })).status).toBe(409);
    expect(Number((await row()).proposedRate)).toBe(150);
  });

  it("requires the amount the admin saw", async () => {
    await propose(1500);
    expect((await decision({ approve: true })).status).toBe(400);
    expect((await row()).proposedRate).not.toBeNull();
  });

  it("matches paise exactly as the page sends them", async () => {
    await propose(1500.5);
    const shown = String((await row()).proposedRate);
    expect((await decision({ approve: true, proposedRate: shown })).status).toBe(200);
    expect(Number((await row()).rate)).toBe(1500.5);
  });

  it("has the page send the amount it shows", async () => {
    await propose(1500);
    session.user = await makeUser("ADMIN", "Boss");
    const page = await ServiceTypesPage({ searchParams: Promise.resolve({}) });
    // RateDecision is a plain function in the page, so render its element to reach the buttons.
    const decisions = elements(page).filter((e) => typeof e.type === "function" && (e.type as { name: string }).name === "RateDecision");
    expect(decisions.length).toBeGreaterThan(0);
    const buttons = elements((decisions[0].type as (p: unknown) => unknown)(decisions[0].props)).filter((e) => e.props.endpoint);
    expect(buttons.map((b) => b.props.body)).toEqual([{ approve: true, proposedRate: "1500" }, { approve: false, proposedRate: "1500" }]);
  });
});

describe("the review_draft_rates migration", () => {
  const sql = readFileSync("prisma/migrations/20261101070000_review_draft_rates/migration.sql", "utf8");
  const type = (name: string) => db.serviceType.findUniqueOrThrow({ where: { name } });

  it("takes unreviewed draft prices away from customers until an admin approves them", async () => {
    await db.serviceType.create({ data: { name: "Car Wash", rate: 300 } });
    await db.$executeRawUnsafe(sql);
    expect(await type("Car Wash")).toMatchObject({ rate: null, proposedBy: "Starting price", proposedById: null });
    expect(Number((await type("Car Wash")).proposedRate)).toBe(300);
    expect(await ratedServices()).toEqual([]);
    expect(await defaultRate("Car Wash")).toBeNull();

    const admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const { id } = await type("Car Wash");
    expect((await call(decide, "POST", { cookie: admin, params: { id }, body: { approve: true, proposedRate: 300 } })).status).toBe(200);
    expect(await ratedServices()).toEqual([{ name: "Car Wash", rate: 300 }]);
  });

  it("leaves alone a rate an admin changed, set or approved, and anything else", async () => {
    const [same] = await Promise.all([
      db.serviceType.create({ data: { name: "Oil Change", rate: 1500 } }),
      db.serviceType.create({ data: { name: "Foam Wash", rate: 650 } }),
      db.serviceType.create({ data: { name: "My Own Service", rate: 300 } }),
      db.serviceType.create({ data: { name: "Polishing" } }),
      db.serviceType.create({ data: { name: "Wheel Balancing", kind: "PART", rate: 500 } }),
    ]);
    await db.activityLog.create({ data: { actorRole: "ADMIN", action: "SERVICE_RATE_UPDATED", entityType: "ServiceType", entityId: same.id, summary: "x" } });
    await db.$executeRawUnsafe(sql);
    for (const [name, rate] of [["Oil Change", 1500], ["Foam Wash", 650], ["My Own Service", 300], ["Wheel Balancing", 500]] as const) {
      const t = await type(name);
      expect(Number(t.rate), name).toBe(rate);
      expect(t.proposedRate, name).toBeNull();
    }
    expect(await type("Polishing")).toMatchObject({ rate: null, proposedRate: null });
  });

  it("keeps a request staff already made, but still takes the draft down", async () => {
    await db.serviceType.create({ data: { name: "Car Wash", rate: 300, proposedRate: 350, proposedBy: "Rita" } });
    await db.$executeRawUnsafe(sql);
    const t = await type("Car Wash");
    expect(t.rate).toBeNull();
    expect(Number(t.proposedRate)).toBe(350);
    expect(t.proposedBy).toBe("Rita");
  });

  it("does nothing when run again", async () => {
    await db.serviceType.create({ data: { name: "Car Wash", rate: 300 } });
    await db.$executeRawUnsafe(sql);
    expect(await db.$executeRawUnsafe(sql)).toBe(0);
  });
});

describe("auto-assigning a booking", () => {
  let booked = 0;
  const book = async (dayKey: string | null) => {
    booked++;
    const customer = await makeCustomer(`9190000${String(booked).padStart(5, "0")}`, "Booker");
    const vehicle = await makeVehicle(customer.id, `TN01ZZ${String(booked).padStart(4, "0")}`);
    const appointmentDate = dayKey ? new Date(`${dayKey}T10:00:00+05:30`) : null;
    return createJob(SYSTEM_ACTOR, { customerId: customer.id, vehicleId: vehicle.id, serviceType: "General Service", customerComplaint: null, internalNotes: null, estimatedAmount: 1000, appointmentDate, expectedCompletion: null });
  };
  const leaveOn = (userId: string, dayKey: string) => db.attendance.create({ data: { userId, date: dayKeyToDate(dayKey), status: "LEAVE" } });
  beforeEach(() => db.setting.create({ data: { key: "auto_assign_enabled", value: "true" } }));

  it("skips a worker on leave on the booked day", async () => {
    const [ann, bob] = [await makeUser("WORKER", "Ann"), await makeUser("WORKER", "Bob")];
    const day = addDayKey(todayKey(), 3);
    await leaveOn(ann.id, day);
    expect((await book(day)).assignedWorkerId).toBe(bob.id);
  });

  it("can use a worker who is off today but in on the booked day", async () => {
    const [ann] = [await makeUser("WORKER", "Ann"), await makeUser("WORKER", "Bob")];
    await leaveOn(ann.id, todayKey());
    expect((await book(addDayKey(todayKey(), 3))).assignedWorkerId).toBe(ann.id);
  });

  it("goes by today when there's no booked day, or it has passed", async () => {
    const [ann, bob] = [await makeUser("WORKER", "Ann"), await makeUser("WORKER", "Bob")];
    await leaveOn(ann.id, todayKey());
    expect((await book(null)).assignedWorkerId).toBe(bob.id);
    await db.serviceJob.updateMany({ data: { status: "CANCELLED" } });
    expect((await book(addDayKey(todayKey(), -2))).assignedWorkerId).toBe(bob.id);
  });

  it("leaves the job unassigned and names the day when everyone is off then", async () => {
    const ann = await makeUser("WORKER", "Ann");
    const day = addDayKey(todayKey(), 3);
    await leaveOn(ann.id, day);
    const job = await book(day);
    expect(job.assignedWorkerId).toBeNull();
    const log = await db.activityLog.findFirstOrThrow({ where: { action: "AUTO_ASSIGN_SKIPPED", entityId: job.id } });
    expect(log.summary).toContain(`on ${day}`);
  });
});

describe("what the bill form offers", () => {
  it("drops a hidden item, its approved rate and its price list fallback", async () => {
    await db.setting.create({ data: { key: "price_list", value: "Engine Oil = 800\nCar Wash = 250\nLoose Item = 55" } });
    await db.serviceType.createMany({
      data: [
        { name: "Engine Oil", kind: "PART", rate: 950, active: false },
        { name: "Car Wash", rate: 300, active: false },
        { name: "Coolant", kind: "PART", rate: 500 },
      ],
    });
    const prices = await billPrices();
    expect(prices["Engine Oil"]).toBeUndefined();
    expect(prices["Car Wash"]).toBeUndefined();
    expect(prices).toMatchObject({ Coolant: 500, "Loose Item": 55 });
    expect(await activePartNames()).toEqual(["Coolant"]);
    expect(await activeServiceNames()).not.toContain("Car Wash");
  });

  it("lists catalog services, keeps ready-made names with no row, and hides one that gets a hidden row", async () => {
    await db.serviceType.createMany({ data: [{ name: "Nano Wash" }, { name: "Waxing", active: false }, { name: "Horn", kind: "PART" }] });
    const names = await activeServiceNames();
    expect(names).toContain("Nano Wash");
    expect(names).toContain("Labour Charge");
    expect(names).not.toContain("Waxing");
    expect(names).not.toContain("Horn");
  });

  it("leaves no built-in name outside the catalog, so a rename can't leave the old name behind", () => {
    const parts = readFileSync("prisma/migrations/20261101050000_service_type_kind/migration.sql", "utf8");
    for (const name of PART_NAMES) expect(parts, name).toContain(`'${name}'`);
    const services = readFileSync("prisma/migrations/20261101000000_work_catalog/migration.sql", "utf8");
    for (const name of WORK_NAMES.filter((n) => !UNCATALOGUED_WORK_NAMES.includes(n))) expect(services, name).toContain(`'${name}'`);
    for (const name of UNCATALOGUED_WORK_NAMES) {
      expect(WORK_NAMES, name).toContain(name);
      expect(services, name).not.toContain(`'${name}'`);
    }
  });

  it("clears the customer approval tick whenever the form resets", () => {
    const source = readFileSync("components/work-item-dialog.tsx", "utf8");
    const reset = source.slice(source.indexOf("function reset()"), source.indexOf("function pick("));
    expect(reset).toContain("setNeedsApproval(false)");
  });
});

describe("list rows", () => {
  const rowKeys = (el: unknown) => {
    const rows = elements(el).filter((e) => Array.isArray(e.props.children) && e.key !== null && e.key !== undefined);
    return rows.map((r) => r.key);
  };

  it("are keyed by record, so a dialog follows its record when rows shift", () => {
    const table = SimpleTable({ headers: ["A"], rows: [["x"], ["y"]], rowKeys: ["id-1", "id-2"] });
    expect(rowKeys(table)).toEqual(expect.arrayContaining(["id-1", "id-2"]));
  });

  it("are given a record key wherever a row holds a dialog", () => {
    for (const file of [
      "components/customers-panel.tsx",
      "app/admin/service-types/page.tsx",
      "components/attendance-view.tsx",
      "app/admin/jobs/[id]/page.tsx",
      "app/worker/jobs/[id]/page.tsx",
      "components/rates-view.tsx",
      "components/employees-view.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).toContain("rowKeys={");
    }
  });
});

describe("automatic refresh", () => {
  const doc = (present: string[]) => ({ querySelector: (s: string) => (s.split(", ").some((part) => present.includes(part)) ? ({} as Element) : null) });

  it("waits while a dialog or a pending confirmation is open", () => {
    expect(liveRefreshPaused(doc([]))).toBe(false);
    expect(liveRefreshPaused(doc(['[data-slot="dialog-content"]']))).toBe(true);
    expect(liveRefreshPaused(doc(["[data-live-refresh-pause]"]))).toBe(true);
  });

  it("looks for what the dialog and voice prompt really render", () => {
    expect(LIVE_REFRESH_PAUSE).toContain('[data-slot="dialog-content"]');
    expect(readFileSync("components/ui/dialog.tsx", "utf8")).toContain('data-slot="dialog-content"');
    expect(readFileSync("components/voice-status.tsx", "utf8")).toContain("data-live-refresh-pause");
    for (const file of ["components/live-refresh.tsx", "components/inbox.tsx"]) expect(readFileSync(file, "utf8"), file).toContain("liveRefreshPaused(document)");
  });
});

describe("dropping a card", () => {
  const column = (key: string, drop?: Record<string, unknown>) => ({ key, drop });

  it("only accepts a column the card can land in", () => {
    expect(canDrop({}, "a", column("b", { active: true }))).toBe(true);
    expect(canDrop({}, "a", column("a", { active: true }))).toBe(false);
    expect(canDrop({}, "a", column("b"))).toBe(false);
    expect(canDrop({ dropTo: ["c"] }, "a", column("b", { active: true }))).toBe(false);
    expect(canDrop({ dropTo: ["b"] }, "a", column("b", { active: true }))).toBe(true);
    expect(canDrop({ dropTo: [] }, "a", column("b", { active: true }))).toBe(false);
  });

});

describe("old vehicles links", () => {
  it("keep their view and search", async () => {
    session.user = await makeUser("ADMIN", "Admin");
    const go = (searchParams: { q?: string; view?: string }) => VehiclesPage({ searchParams: Promise.resolve(searchParams) });
    const to = "/admin/customers-jobs?tab=customers";
    await expect(go({})).rejects.toThrow(`REDIRECT:${to}`);
    await expect(go({ view: "list" })).rejects.toThrow(`REDIRECT:${to}&view=list`);
    await expect(go({ view: "list", q: "TN 38" })).rejects.toThrow(`REDIRECT:${to}&view=list&q=TN+38`);
    await expect(go({ q: "Creta" })).rejects.toThrow(`REDIRECT:${to}&q=Creta`);
  });

  it("find customers by the make and model on their vehicles, without widening the top search", async () => {
    const cookie = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const c = await makeCustomer("919000022222", "Asha");
    await makeVehicle(c.id, "TN38AB1234", "Creta");
    await makeCustomer("919000033333", "Other");
    for (const q of ["creta", "HYUNDAI"]) {
      const { json } = await call(listCustomers, "GET", { cookie, path: `/api/customers?q=${q}` });
      expect(json.data.map((x: { id: string }) => x.id), q).toEqual([c.id]);
    }
    const { contactSearchWhere } = await import("@/lib/services/customers");
    expect(await db.customer.count({ where: contactSearchWhere("Creta") })).toBe(0);
  });
});

