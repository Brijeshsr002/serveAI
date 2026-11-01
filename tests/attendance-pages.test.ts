import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { dayKeyToDate } from "@/lib/format";
import { clockIn, todayKey } from "@/lib/services/attendance";
import { makeUser } from "./helpers";

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
vi.mock("@/components/live-scene", () => ({ LiveScene: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/charts", () => ({ SingleBarChart: () => null, WorkerChart: () => null }));

const { default: Dashboard } = await import("@/app/admin/dashboard/page");
const { default: AttendancePage } = await import("@/app/admin/attendance/page");
const { default: StaffPage } = await import("@/app/admin/staff/[id]/page");
const { default: WorkerProfile } = await import("@/app/worker/profile/page");
const { default: ReceptionProfile } = await import("@/app/reception/profile/page");
const { default: WorkerDashboard } = await import("@/app/worker/dashboard/page");
const { default: WorkersPage } = await import("@/app/admin/workers/page");
const { default: ReceptionistsPage } = await import("@/app/admin/receptionists/page");
const { default: ActivityPage } = await import("@/app/admin/activity/page");
const { default: ReportsPage } = await import("@/app/admin/reports/page");
const { default: InvoicesPage } = await import("@/app/admin/invoices/page");
const { default: InvoicePage } = await import("@/app/admin/invoices/[id]/page");
const { default: MessagesPage } = await import("@/app/admin/messages/page");
const { default: ServiceTypesPage } = await import("@/app/admin/service-types/page");
const { default: SettingsPage } = await import("@/app/admin/settings/page");
const { default: WorkerRates } = await import("@/app/worker/service-rates/page");
const { default: ReceptionRates } = await import("@/app/reception/service-rates/page");

/** Runs a server page and renders it to HTML, entities decoded enough for text checks. */
async function html(element: ReactElement) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
}
const asUser = (u: { id: string; name: string; email: string; phone: string | null; role: Role }) => { session.user = u; };

const SECRET = "SECRET-STAFF-NOTE";

describe("attendance and staff pages", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>, worker: Awaited<ReturnType<typeof makeUser>>, reception: Awaited<ReturnType<typeof makeUser>>;

  beforeEach(async () => {
    admin = await makeUser("ADMIN", "Admin");
    worker = await makeUser("WORKER", "Raj");
    reception = await makeUser("RECEPTIONIST", "Rita");
    await db.user.update({ where: { id: worker.id }, data: { salary: "98765.43", staffNotes: SECRET, jobTitle: "Mechanic" } });
  });

  it("the admin dashboard shows the team card, without salary", async () => {
    asUser(admin);
    await clockIn(worker.id);
    const page = await html(await Dashboard());
    expect(page).toContain("Team Attendance");
    expect(page).toContain("View full attendance");
    expect(page).toContain("Mechanic");
    expect(page).toContain("Not clocked in");
    expect(page).toMatch(/In at \d/);
    expect(page).toContain(`/admin/staff/${worker.id}`);
    expect(page).not.toContain("98,765");
    expect(page).not.toContain(SECRET);
  });

  it("the reception dashboard has a clock card and no team card", async () => {
    asUser(reception);
    const page = await html(await Dashboard());
    expect(page).not.toContain("Team Attendance");
    expect(page).not.toContain("Raj");
    expect(page).toContain("Clock in");
  });

  it("the worker dashboard offers one button for the day's state", async () => {
    asUser(worker);
    let page = await html(await WorkerDashboard());
    expect(page).toContain("Not clocked in");
    expect(page).toContain("Clock in");
    await clockIn(worker.id);
    page = await html(await WorkerDashboard());
    expect(page).toContain("Clock out");
    expect(page).not.toContain("Clock in<");
    await db.attendance.deleteMany();
    await db.attendance.create({ data: { userId: worker.id, date: dayKeyToDate(todayKey()), status: "LEAVE" } });
    page = await html(await WorkerDashboard());
    expect(page).toContain("On leave");
    expect(page).not.toContain("Clock in<");
    expect(page).not.toContain("Clock out<");
  });

  it("the attendance page takes a date and falls back on a bad one", async () => {
    asUser(admin);
    await db.user.updateMany({ data: { joinedOn: dayKeyToDate("2026-01-01") } });
    const dated = await html(await AttendancePage({ searchParams: Promise.resolve({ date: "2026-03-15" }) }));
    expect(dated).toContain("SUNDAY, MARCH 15");
    expect(dated).toContain("Month summary, March 2026");
    expect(dated).toContain("Absent");
    for (const date of ["2026-02-30", "'; DROP TABLE", ["2026-03-15", "x"]]) {
      const page = await html(await AttendancePage({ searchParams: Promise.resolve({ date }) }));
      expect(page).toContain("Mark leave");
      expect(page).not.toContain("MARCH 15");
    }
    expect(dated).not.toContain("98,765");
  });

  it("the attendance page keeps a deactivated person's record, with a dash for absence", async () => {
    asUser(admin);
    await db.user.updateMany({ data: { joinedOn: dayKeyToDate("2026-01-01") } });
    await db.attendance.create({ data: { userId: worker.id, date: dayKeyToDate("2026-03-15"), status: "LEAVE", note: "First line\nSecond line" } });
    await db.user.update({ where: { id: worker.id }, data: { active: false } });
    const page = await html(await AttendancePage({ searchParams: Promise.resolve({ date: "2026-03-15" }) }));
    expect(page).toContain("Raj (inactive)");
    expect(page).toContain("Mechanic · Inactive");
    expect(page).toMatch(/Raj \(inactive\)<\/a><\/td>(<td[^>]*>[^<]*<\/td>){2}<td[^>]*>—<\/td>/);
    // Long notes wrap inside a capped column, keeping their line breaks, so the actions stay on screen.
    expect(page).toMatch(/<span class="[^"]*max-w-64[^"]*whitespace-pre-line[^"]*">First line\s+Second line<\/span>/);
  });

  it("the admin staff page shows the form, salary and notes, and 404s for others", async () => {
    asUser(admin);
    const page = await html(await StaffPage({ params: Promise.resolve({ id: worker.id }) }));
    for (const text of ["Edit profile", "Monthly salary", "98,765.43", SECRET, "Information only", "Jobs completed this month"]) expect(page).toContain(text);
    await expect(async () => StaffPage({ params: Promise.resolve({ id: admin.id }) })).rejects.toThrow("NOT_FOUND");
  });

  it("a receptionist's staff page shows jobs created instead", async () => {
    asUser(admin);
    const page = await html(await StaffPage({ params: Promise.resolve({ id: reception.id }) }));
    expect(page).toContain("Jobs created this month");
    expect(page).toContain("Not set");
  });

  it("a worker's own profile shows their salary but never their notes", async () => {
    asUser(worker);
    const page = await html(await WorkerProfile());
    expect(page).toContain("98,765.43");
    expect(page).toContain("Information only");
    expect(page).toContain("Change password");
    expect(page).not.toContain(SECRET);
    expect(page).not.toContain("Edit profile");
  });

  it("a receptionist's own profile works too", async () => {
    asUser(reception);
    const page = await html(await ReceptionProfile());
    expect(page).toContain("Jobs created this month");
    expect(page).not.toContain(SECRET);
  });

  it("the admin pages refuse anyone else", async () => {
    asUser(worker);
    await expect(AttendancePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT");
    await expect(StaffPage({ params: Promise.resolve({ id: worker.id }) })).rejects.toThrow("REDIRECT");
  });

  // Layouts don't run for a client-side navigation that claims to hold them, so each page guards itself.
  describe("page guards", () => {
    const empty = Promise.resolve({});
    const adminOnly: [string, () => Promise<unknown>][] = [
      ["workers", () => WorkersPage({ searchParams: empty })],
      ["receptionists", () => ReceptionistsPage({ searchParams: empty })],
      ["activity", () => ActivityPage()],
      ["reports", () => ReportsPage()],
      ["invoices", () => InvoicesPage({ searchParams: empty })],
      ["invoice", () => InvoicePage({ params: Promise.resolve({ id: "x" }) })],
      ["messages", () => MessagesPage()],
      ["service types", () => ServiceTypesPage({ searchParams: empty })],
      ["settings", () => SettingsPage()],
    ];

    it.each(adminOnly)("the %s page refuses anyone but an admin", async (_name, run) => {
      for (const user of [worker, reception, null]) {
        session.user = user;
        await expect(run()).rejects.toThrow("REDIRECT");
      }
    });

    it("an admin still gets the staff lists and the audit trail", async () => {
      asUser(admin);
      expect(await html((await WorkersPage({ searchParams: empty })) as ReactElement)).toContain("raj@test.local");
      expect(await html((await ReceptionistsPage({ searchParams: empty })) as ReactElement)).toContain("rita@test.local");
      expect(await html(await ActivityPage())).toContain("Audit trail");
    });

    it("the service rate pages only open for their own role", async () => {
      session.user = null;
      await expect(WorkerRates()).rejects.toThrow("REDIRECT");
      await expect(ReceptionRates()).rejects.toThrow("REDIRECT");
      asUser(reception);
      await expect(WorkerRates()).rejects.toThrow("REDIRECT");
      expect(await html(await ReceptionRates())).toContain("Service Rates");
      asUser(worker);
      await expect(ReceptionRates()).rejects.toThrow("REDIRECT");
      expect(await html(await WorkerRates())).toContain("Service Rates");
    });

    it("every signed-in page checks the role itself", () => {
      const pages = ["app/admin", "app/worker", "app/reception"].flatMap((root) =>
        readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => path.basename(f) === "page.tsx").map((f) => path.join(root, f)),
      );
      expect(pages.length).toBeGreaterThan(30);
      const unguarded = pages.filter((file) => {
        const source = readFileSync(file, "utf8");
        // A reception page may re-export an admin one, which this same check covers.
        return !source.includes("await requireRole(") && !/^export \{ default \} from "@\/app\/admin\/[^"]+\/page";\s*$/.test(source);
      });
      expect(unguarded).toEqual([]);
    });
  });

  it("no source file hard-codes orange", () => {
    const hits = ["app", "components", "lib"].flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((f) => /\.(tsx?|css)$/.test(f))
        .map((f) => path.join(root, f))
        .filter((file) => /\borange\b|-orange-/.test(readFileSync(file, "utf8"))),
    );
    expect(hits).toEqual([]);
  });
});
