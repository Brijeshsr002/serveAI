import { Pencil } from "lucide-react";
import { ActionButton, FormDialog } from "@/components/actions";
import { DataBoard, isBoardView, ViewSwitch } from "@/components/data-board";
import { employeeCreateFields, employeeEditFields } from "@/components/forms-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, SearchForm, Section, SimpleTable, StatCard, TextLink } from "@/components/ui-kit";
import { istMonthKey, monthLabel, money } from "@/lib/format";
import { type Employee, employeeRoleLabel, listEmployees } from "@/lib/services/employees";

const salaryText = (e: Employee) => (e.salary === null ? "Not set" : money(e.salary));
const monthText = (e: Employee) => `${e.attendance.present} present · ${e.attendance.leave} leave · ${e.attendance.absent ?? "—"} absent`;
const performanceText = (e: Employee) => (e.role === "WORKER" ? `${e.activeJobs} active · ${e.completedInMonth} completed` : `${e.createdInMonth} job${e.createdInMonth === 1 ? "" : "s"} created`);

/** A plain GET form: the report downloads with no client code, and a profile reloads for the month. */
function MonthForm({ action, month, label }: { action?: string; month: string; label: string }) {
  return (
    <form action={action} method="get" className="flex items-center gap-1.5">
      <Input type="month" name="month" defaultValue={month} aria-label="Month" className="w-44" />
      <Button type="submit" variant="outline" size="sm">{label}</Button>
    </form>
  );
}

export function EditEmployee({ e }: { e: Employee }) {
  return (
    <FormDialog
      trigger={<Pencil className="size-3.5" />}
      triggerLabel={`Edit ${e.name}`}
      triggerSize="icon-sm"
      variant="ghost"
      title={`Edit ${e.name}`}
      method="PATCH"
      endpoint={`/api/users/${e.id}/profile`}
      fields={employeeEditFields}
      onlyChanged
      initial={{ role: e.role, name: e.name, phone: e.phone, email: e.email, jobTitle: e.jobTitle, salary: e.salary, joinedOn: e.joinedOn, active: e.active }}
    />
  );
}

export async function EmployeesView({ view, q }: { view?: string; q?: string }) {
  const board = isBoardView(view);
  const employees = await listEmployees({ q });
  const month = istMonthKey(new Date());
  const columns = [
    // Dropping on a role column also brings back someone inactive, because that's where the card lands.
    { key: "workers", label: "Workers", color: "bg-blue-100 text-blue-700", drop: { role: "WORKER", active: true }, match: (e: Employee) => e.active && e.role === "WORKER" },
    { key: "reception", label: "Reception", color: "bg-green-100 text-green-800", drop: { role: "RECEPTIONIST", active: true }, match: (e: Employee) => e.active && e.role === "RECEPTIONIST" },
    { key: "inactive", label: "Inactive", color: "bg-slate-100 text-slate-700", drop: { active: false }, match: (e: Employee) => !e.active },
  ].map(({ match, ...col }) => ({
    ...col,
    cards: employees.filter(match).map((e) => ({
      id: e.id,
      title: <TextLink href={`/admin/staff/${e.id}`}>{e.name}</TextLink>,
      actions: <EditEmployee e={e} />,
      lines: [
        [employeeRoleLabel(e.role), e.jobTitle].filter(Boolean).join(" · "),
        e.phone ?? "No phone",
        e.email,
        `Salary: ${salaryText(e)}`,
        `Today: ${e.today}`,
        `${monthLabel(month)}: ${monthText(e)}`,
        performanceText(e),
      ],
    })),
  }));
  return (
    <>
      <PageHeader title="Employees" subtitle={`${employees.length} shown`}>
        <ViewSwitch board={board} q={q} />
        <MonthForm action="/api/employees/report" month={month} label="Download report" />
        <FormDialog trigger="+ Add employee" title="Add employee" endpoint="/api/employees" fields={employeeCreateFields} success="Employee added" />
      </PageHeader>
      <SearchForm q={q} view={board ? undefined : "list"} placeholder="Search name, phone or email" />
      {board ? <DataBoard columns={columns} empty="None" dropEndpoint="/api/users/:id/profile" /> : <Section title="All employees">
        <SimpleTable
          headers={["Name", "Role", "Phone", "Monthly salary", "Today", monthLabel(month), "Performance", "Actions"]}
          empty={q ? "No employees match" : "No employees yet"}
          rowKeys={employees.map((e) => e.id)}
          rows={employees.map((e) => [
            <div key="n"><TextLink href={`/admin/staff/${e.id}`}>{e.name}</TextLink><div className="text-xs text-muted-foreground">{e.email}</div></div>,
            <div key="r">{employeeRoleLabel(e.role)}{e.jobTitle && <div className="text-xs text-muted-foreground">{e.jobTitle}</div>}</div>,
            e.phone ?? "—",
            salaryText(e),
            e.active ? e.today : "Inactive",
            monthText(e),
            performanceText(e),
            <div key="a" className="flex items-center gap-1.5">
              <EditEmployee e={e} />
              {e.active && <ActionButton label="Deactivate" variant="ghost" method="DELETE" endpoint={`/api/users/${e.id}`} confirm={`Deactivate ${e.name}? They won't be able to log in.`} success="Employee deactivated" />}
            </div>,
          ])}
        />
      </Section>}
    </>
  );
}

/** The same figures as the CSV, for one person and one month. */
export async function EmployeeMonthReport({ id, month }: { id: string; month: string }) {
  const [e] = await listEmployees({ id, month });
  if (!e) return null;
  return (
    <Section title={`Report, ${monthLabel(month)}`}>
      <div className="mb-3"><MonthForm month={month} label="Show" /></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Monthly salary" value={salaryText(e)} />
        <StatCard label="Days present" value={e.attendance.present} />
        <StatCard label="Days on leave" value={e.attendance.leave} />
        <StatCard label="Days absent" value={e.attendance.absent ?? "—"} />
        {e.role === "WORKER" ? (
          <>
            <StatCard label="Active jobs now" value={e.activeJobs} />
            <StatCard label="Jobs completed" value={e.completedInMonth} />
          </>
        ) : (
          <StatCard label="Jobs created" value={e.createdInMonth} />
        )}
      </div>
    </Section>
  );
}
