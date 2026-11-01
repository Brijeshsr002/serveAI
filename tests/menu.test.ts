import { existsSync, readFileSync } from "node:fs";
import type { Role } from "@prisma/client";
import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANGELOG, LATEST_VERSION } from "@/lib/changelog";
import { movedTo } from "@/lib/redirects";
import { makeCustomer, makeUser } from "./helpers";

const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; email: string; phone: string | null; role: Role } }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/admin/dashboard",
}));
vi.mock("@/lib/auth/page", () => ({
  currentUser: async () => session.user,
  requireRole: async (roles: Role[]) => {
    if (!session.user || !roles.includes(session.user.role)) throw new Error("REFUSED");
    return session.user;
  },
}));
vi.mock("@/components/live-scene", () => ({ LiveScene: ({ children }: { children: unknown }) => children }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPage = (props?: any) => Promise<unknown>;
const PAGES: Record<string, () => Promise<{ default: AnyPage }>> = {
  "admin/jobs": () => import("@/app/admin/jobs/page") as Promise<{ default: AnyPage }>,
  "admin/customers": () => import("@/app/admin/customers/page") as Promise<{ default: AnyPage }>,
  "admin/vehicles": () => import("@/app/admin/vehicles/page") as Promise<{ default: AnyPage }>,
  "admin/attendance": () => import("@/app/admin/attendance/page") as Promise<{ default: AnyPage }>,
  "admin/reports": () => import("@/app/admin/reports/page") as Promise<{ default: AnyPage }>,
  "admin/customers-jobs": () => import("@/app/admin/customers-jobs/page") as Promise<{ default: AnyPage }>,
  "admin/employees": () => import("@/app/admin/employees/page") as Promise<{ default: AnyPage }>,
  "admin/dashboard": () => import("@/app/admin/dashboard/page") as Promise<{ default: AnyPage }>,
  "admin/service-types": () => import("@/app/admin/service-types/page") as Promise<{ default: AnyPage }>,
  "admin/whatsapp": () => import("@/app/admin/whatsapp/page") as Promise<{ default: AnyPage }>,
  "admin/messages": () => import("@/app/admin/messages/page") as Promise<{ default: AnyPage }>,
  "reception/jobs": () => import("@/app/reception/jobs/page") as Promise<{ default: AnyPage }>,
  "reception/customers": () => import("@/app/reception/customers/page") as Promise<{ default: AnyPage }>,
  "reception/vehicles": () => import("@/app/reception/vehicles/page") as Promise<{ default: AnyPage }>,
  "reception/customers-jobs": () => import("@/app/reception/customers-jobs/page") as Promise<{ default: AnyPage }>,
};
const page = async (path: string) => (await PAGES[path]()).default;
const { Shell, navActive } = await import("@/components/shell");

const params = (search: object = {}) => ({ searchParams: Promise.resolve(search) });
async function html(element: unknown) {
  const stream = await renderToReadableStream(element as ReactElement);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/<!-- -->/g, "");
}
const as = async (role: Role, name: string = role) => { session.user = await makeUser(role, name); };
const landsOn = async (run: () => Promise<unknown>) => {
  const err = await run().then(() => null, (e: Error) => e);
  expect(err?.message).toMatch(/^REDIRECT:/);
  const to = err!.message.slice("REDIRECT:".length);
  expect(existsSync(`app${to.split("?")[0]}/page.tsx`), to).toBe(true);
  return to;
};
const shell = (role: Role) => html(createElement(Shell, { role, name: "X", garage: "Car's Spa", children: null }));
const labels = (text: string) => [...text.matchAll(/<a [^>]*href="\/(?:admin|reception|worker)\/[^"]*"[^>]*>.*?<\/a>/g)].map((m) => m[0].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim());

describe("movedTo", () => {
  it("carries the query over, repeats included, and the fixed values win", () => {
    expect(movedTo("/x")).toBe("/x");
    expect(movedTo("/x", { a: "1", b: undefined })).toBe("/x?a=1");
    expect(movedTo("/x", { a: ["1", "2"] })).toBe("/x?a=1&a=2");
    expect(movedTo("/x", { tab: "evil", q: "a b" }, { tab: "good" })).toBe("/x?tab=good&q=a+b");
    expect(movedTo("/x", { q: "https://evil.test/?a=1&b=2" })).toBe("/x?q=https%3A%2F%2Fevil.test%2F%3Fa%3D1%26b%3D2");
  });
});

describe("old addresses", () => {
  it("send an admin to the new page, with the query", async () => {
    await as("ADMIN");
    const go = async (path: string, search: object = {}) => landsOn(async () => (await page(path))(params(search)));
    expect(await go("admin/jobs")).toBe("/admin/customers-jobs?tab=jobs");
    expect(await go("admin/jobs", { q: "TN 38", status: "NEW", view: "list" })).toBe("/admin/customers-jobs?tab=jobs&q=TN+38&status=NEW&view=list");
    expect(await go("admin/customers")).toBe("/admin/customers-jobs?tab=customers");
    expect(await go("admin/customers", { q: "Priya", view: "list" })).toBe("/admin/customers-jobs?tab=customers&q=Priya&view=list");
    expect(await go("admin/customers", { tab: "jobs" })).toBe("/admin/customers-jobs?tab=customers");
    expect(await go("admin/vehicles", { q: "Creta" })).toBe("/admin/customers-jobs?tab=customers&q=Creta");
    expect(await go("admin/attendance")).toBe("/admin/employees?tab=attendance");
    expect(await go("admin/attendance", { date: "2026-03-15" })).toBe("/admin/employees?tab=attendance&date=2026-03-15");
    expect(await landsOn(async () => (await page("admin/reports"))())).toBe("/admin/dashboard");
  });

  it("send reception to reception's page, with the query", async () => {
    await as("RECEPTIONIST");
    const go = async (path: string, search: object = {}) => landsOn(async () => (await page(path))(params(search)));
    expect(await go("reception/jobs", { q: "x" })).toBe("/reception/customers-jobs?tab=jobs&q=x");
    expect(await go("reception/customers", { view: "list" })).toBe("/reception/customers-jobs?tab=customers&view=list");
    expect(await go("reception/vehicles")).toBe("/reception/customers-jobs?tab=customers");
  });

  it("refuse anyone who couldn't open the page they point to", async () => {
    const adminOnly = ["admin/attendance", "admin/reports"];
    const staff = ["admin/jobs", "admin/customers", "admin/vehicles", "reception/jobs", "reception/customers", "reception/vehicles", "admin/customers-jobs", "reception/customers-jobs"];
    await as("WORKER", "Raj");
    for (const path of [...adminOnly, ...staff]) await expect((await page(path))(params()), path).rejects.toThrow("REFUSED");
    await as("RECEPTIONIST", "Rita");
    for (const path of adminOnly) await expect((await page(path))(params()), path).rejects.toThrow("REFUSED");
    session.user = null;
    for (const path of [...adminOnly, ...staff]) await expect((await page(path))(params()), path).rejects.toThrow("REFUSED");
  });
});

describe("Customers & Jobs", () => {
  beforeEach(async () => {
    await as("ADMIN");
    await makeCustomer("919000011111", "Priya Raman");
  });
  const open = async (search: object = {}) => html(await (await page("admin/customers-jobs"))(params(search)));

  it("opens on the Jobs board, and falls back there on junk", async () => {
    for (const search of [{}, { tab: "jobs" }, { tab: "<script>" }, { tab: ["customers", "jobs"] }, { q: ["a", "b"], view: ["list", "x"], status: ["NEW", "x"] }]) {
      const text = await open(search);
      expect(text).toContain("+ New service job");
      expect(text).not.toContain("+ Add customer");
      expect(text).not.toContain("<script>");
    }
  });

  it("has the search, tabs and view switch on both tabs, and the Customers tab keeps itself", async () => {
    const jobs = await open();
    const customers = await open({ tab: "customers", q: "Priya", view: "list" });
    for (const text of [jobs, customers]) {
      expect(text).toContain('placeholder="Search name, phone or vehicle number"');
      expect(text).toContain("Jobs board");
      expect(text).toMatch(/>Kanban</);
      expect(text).toMatch(/>List</);
    }
    expect(customers).toContain("+ Add customer");
    expect(customers).toContain("Priya Raman");
    expect(customers).toContain('name="tab" value="customers"');
    expect(customers).toContain('href="?tab=customers&q=Priya"');
    expect(customers).toContain('href="?tab=customers&view=list&q=Priya"');
    expect(customers).toContain('href="?view=list&q=Priya&tab=jobs"');
  });

  it("sends a new customer to their own page, and New customer on a job to the Customers tab", () => {
    expect(readFileSync("components/customers-panel.tsx", "utf8")).toContain("redirectTo={`${base}/customers/:id`}");
    expect(existsSync("app/admin/customers/[id]/page.tsx")).toBe(true);
    expect(existsSync("app/reception/customers/[id]/page.tsx")).toBe(true);
    expect(readFileSync("components/job-form.tsx", "utf8")).toContain("`${base}/customers-jobs?tab=customers`");
  });

  it("keeps the detail pages where they were, with the menu item lit", () => {
    for (const base of ["admin", "reception"]) {
      for (const detail of ["jobs", "customers", "vehicles"]) {
        expect(existsSync(`app/${base}/${detail}/[id]/page.tsx`), detail).toBe(true);
        expect(navActive(`/${base}/customers-jobs`, `/${base}/${detail}/1`, `/${base}`), detail).toBe(true);
      }
      expect(navActive(`/${base}/customers-jobs`, `/${base}/customers-jobs`, `/${base}`)).toBe(true);
      expect(navActive(`/${base}/billing`, `/${base}/jobs/1`, `/${base}`)).toBe(false);
    }
    expect(navActive("/admin/whatsapp", "/admin/messages", "/admin")).toBe(true);
    expect(navActive("/admin/settings", "/admin/updates", "/admin")).toBe(true);
  });
});

describe("Attendance in Employees", () => {
  beforeEach(() => as("ADMIN"));
  const open = async (search: object = {}) => html(await (await page("admin/employees"))(params(search)));

  it("has both tabs, People by default", async () => {
    const people = await open();
    expect(people).toContain("+ Add employee");
    expect(people).not.toContain("Month summary");
    expect(people).toContain('href="?tab=attendance"');
    expect(await open({ tab: "junk" })).toContain("+ Add employee");
  });

  it("stays on the tab when moving between days", async () => {
    const text = await open({ tab: "attendance", date: "2026-03-15" });
    expect(text).toContain("Month summary, March 2026");
    expect(text).toContain('href="?tab=attendance&date=2026-03-14"');
    expect(text).toContain('href="?tab=attendance&date=2026-03-16"');
    expect(text).toContain('href="?tab=attendance"');
    expect(text).toContain('name="tab" value="attendance"');
    expect(text).not.toContain("+ Add employee");
  });

  it("is what the dashboard card links to", () => {
    expect(readFileSync("components/team-attendance.tsx", "utf8")).toContain('href="/admin/employees?tab=attendance"');
  });
});

describe("the dashboard's reports", () => {
  const dashboard = async () => html(await (await page("admin/dashboard"))());

  it("gives an admin the figures and downloads, each chart once", async () => {
    await as("ADMIN");
    const text = await dashboard();
    for (const label of ["Services (7 days)", "Services (30 days)", "Completed services", "Cancelled services", "Repeat customers", "Today's Services", "Revenue", "Pending Payments"]) expect(text, label).toContain(label);
    for (const type of ["services", "payments", "workers"]) expect(text).toContain(`href="/api/reports/export?type=${type}"`);
    for (const chart of ["Services by status", "Service type distribution", "Daily revenue (last 14 days)", "Monthly revenue", "Worker performance"]) {
      expect(text.split(chart).length - 1, chart).toBe(1);
    }
    expect(text).not.toContain("Most common service types");
  });

  it("gives reception none of it", async () => {
    await as("RECEPTIONIST");
    const text = await dashboard();
    for (const label of ["Reports", "Services (7 days)", "Repeat customers", "/api/reports/export", "Daily revenue"]) expect(text, label).not.toContain(label);
  });
});

describe("Service Types", () => {
  it("keeps everything on the table: a waiting request can be decided, and anything can be hidden or shown", async () => {
    await as("ADMIN");
    const { db } = await import("@/lib/db");
    await db.serviceType.createMany({ data: [{ name: "Waiting", proposedRate: 10, proposedBy: "Rita" }, { name: "Plain", description: "Described", rate: 300 }, { name: "Gone", active: false }, { name: "Horn", kind: "PART" }] });
    const open = async (search: object = {}) => html(await (await page("admin/service-types"))(params(search)));
    for (const search of [{}, { view: "list" }, { view: "board" }, { view: ["a", "b"] }]) {
      const text = await open(search);
      expect(text).toContain("<table");
      expect(text).not.toContain("Kanban");
      for (const label of ["Waiting", "Described", "₹300", "Rita asked for", ">Approve<", ">Reject<", ">Set rate<", ">Edit<", ">Hide<", ">Show<", ">Hidden<", ">Active<"]) expect(text, label).toContain(label);
      expect(text).not.toContain(">Horn<");
    }
    expect(await open({ kind: "part" })).toContain("Horn");
  });
});

describe("Customer Messages", () => {
  it("is a button on the admin's WhatsApp page only, and the page stays admin-only", async () => {
    const whatsapp = async () => html(await (await page("admin/whatsapp"))(params()));
    await as("ADMIN");
    expect(await whatsapp()).toMatch(/<a [^>]*href="\/admin\/messages"[^>]*>Customer Messages<\/a>/);
    expect(await html(await (await page("admin/messages"))())).toContain("Customer Messages");
    await as("RECEPTIONIST");
    const text = await whatsapp();
    expect(text).not.toContain("Customer Messages");
    expect(text).not.toContain("/admin/messages");
    await expect((await page("admin/messages"))()).rejects.toThrow("REFUSED");
    await as("WORKER", "Raj");
    await expect((await page("admin/messages"))()).rejects.toThrow("REFUSED");
  });
});

describe("the sidebar", () => {
  it("lists exactly what each role should have, in order", async () => {
    expect(labels(await shell("ADMIN"))).toEqual(["Dashboard", "Customers & Jobs", "Employees", "Billing", "WhatsApp", "Service Types", "Settings", "Activity Logs"]);
    expect(labels(await shell("RECEPTIONIST"))).toEqual(["Dashboard", "Customers & Jobs", "Billing", "WhatsApp", "Service Rates", "Profile"]);
    expect(labels(await shell("WORKER"))).toEqual(["My Jobs", "Completed Jobs", "Service Rates", "Profile"]);
  });

  it("has the bell for every role, once, beside the name, and no version, search or Live label", async () => {
    for (const role of ["ADMIN", "RECEPTIONIST", "WORKER"] as Role[]) {
      const text = await shell(role);
      expect(text.match(/aria-label="Notifications"/g), role).toHaveLength(1);
      expect(text.indexOf(">X<"), role).toBeLessThan(text.indexOf('aria-label="Notifications"'));
      expect(text.indexOf("</nav>"), role).toBeGreaterThan(text.indexOf('aria-label="Notifications"'));
      expect(text).not.toContain(`v${LATEST_VERSION}`);
      expect(text).not.toContain("Search name");
      expect(text).not.toMatch(/>\s*Live\s*</);
    }
  });

  it("keeps the slim bar below lg only, with just the menu button and logo", async () => {
    const bar = (await shell("ADMIN")).match(/<header[^>]*>.*?<\/header>/s)![0];
    expect(bar).toMatch(/<header class="[^"]*lg:hidden/);
    expect(bar).toContain('aria-label="Open menu"');
    expect(bar).not.toContain("Notifications");
  });

  it("still refreshes every staff page by itself, and the tracking page keeps its label", () => {
    expect(readFileSync("components/shell.tsx", "utf8")).toContain("<AutoRefresh />");
    expect(readFileSync("components/live-refresh.tsx", "utf8")).toContain("Live\n");
    expect(readFileSync("app/track/[token]/page.tsx", "utf8")).toContain("<LiveRefresh />");
  });

  it("no source links to a moved list page except its redirect", () => {
    for (const file of ["components/shell.tsx", "components/team-attendance.tsx", "components/job-form.tsx", "components/drilldown.tsx", "components/billing-view.tsx", "app/admin/dashboard/page.tsx", "app/admin/whatsapp/page.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/["'`](?:\/admin|\/reception|\$\{base\})\/(?:jobs|customers|vehicles|attendance|reports)["'`?]/);
    }
  });
});

describe("v1.9", () => {
  it("is the latest version", () => {
    expect(LATEST_VERSION).toBe("1.9");
    expect(CHANGELOG.at(-1)?.changes.length).toBeGreaterThan(0);
  });
});
