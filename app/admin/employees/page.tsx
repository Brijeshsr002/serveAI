import { AttendanceView } from "@/components/attendance-view";
import { PageTabs, pickTab } from "@/components/data-board";
import { EmployeesView } from "@/components/employees-view";
import { requireRole } from "@/lib/auth/page";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; view?: string; q?: string; date?: string | string[] }> }) {
  await requireRole(["ADMIN"]);
  const { tab: asked, view, q, date } = await searchParams;
  const tab = pickTab(asked, ["people", "attendance"] as const);
  return (
    <>
      <PageTabs label="Employees" param="tab" active={tab} tabs={[{ key: "people", label: "People" }, { key: "attendance", label: "Attendance" }]} />
      {tab === "people" ? <EmployeesView view={view} q={q} /> : <AttendanceView date={date} />}
    </>
  );
}
