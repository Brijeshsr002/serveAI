import { Pencil } from "lucide-react";
import { ActionButton, FormDialog } from "@/components/actions";
import { DataBoard, isBoardView, ViewSwitch } from "@/components/data-board";
import { userFields } from "@/components/forms-config";
import { PageHeader, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { userSelect } from "@/lib/services/users";
import { ACTIVE_STATUSES } from "@/lib/status";

export async function UsersView({ role, title, view }: { role: "WORKER" | "RECEPTIONIST"; title: string; view?: string }) {
  const board = isBoardView(view);
  const users = await db.user.findMany({
    where: { role },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      ...userSelect,
      _count: {
        select: {
          assignedJobs: { where: { status: { in: ACTIVE_STATUSES } } },
        },
      },
    },
  });
  const completed = await db.serviceJob.groupBy({ by: ["assignedWorkerId"], where: { status: "COMPLETED" }, _count: true });
  const fields = userFields(role);
  const editForm = (u: (typeof users)[number]) => <FormDialog trigger={<Pencil className="size-3.5" />} triggerLabel={`Edit ${u.name}`} triggerSize="icon-sm" variant="ghost" title={`Edit ${u.name}`} method="PATCH" endpoint={`/api/users/${u.id}`} fields={[...fields, { name: "password", label: "New password (leave blank to keep)", type: "password", omitEmpty: true }, { name: "active", label: "Active", type: "checkbox" }]} initial={{ name: u.name, email: u.email, phone: u.phone, role: u.role, active: u.active }} success="Saved" />;
  const groups = role === "WORKER"
    ? [
        { key: "free", label: "Free", color: "bg-green-100 text-green-800", drop: { active: true }, match: (u: (typeof users)[number]) => u.active && u._count.assignedJobs === 0 },
        { key: "busy", label: "On jobs", color: "bg-blue-100 text-blue-700", match: (u: (typeof users)[number]) => u.active && u._count.assignedJobs > 0 },
        { key: "off", label: "Inactive", color: "bg-slate-100 text-slate-700", drop: { active: false }, match: (u: (typeof users)[number]) => !u.active },
      ]
    : [
        { key: "on", label: "Active", color: "bg-green-100 text-green-800", drop: { active: true }, match: (u: (typeof users)[number]) => u.active },
        { key: "off", label: "Inactive", color: "bg-slate-100 text-slate-700", drop: { active: false }, match: (u: (typeof users)[number]) => !u.active },
      ];
  const columns = groups.map(({ match, ...col }) => ({
    ...col,
    cards: users.filter(match).map((u) => ({
      id: u.id,
      title: <TextLink href={`/admin/staff/${u.id}`}>{u.name}</TextLink>,
      actions: editForm(u),
      lines: [u.email, u.phone ?? "No phone"],
      ...(role === "WORKER" ? { left: `${u._count.assignedJobs} active`, right: `${completed.find((c) => c.assignedWorkerId === u.id)?._count ?? 0} completed` } : {}),
    })),
  }));
  return (
    <>
      <PageHeader title={title}>
        <ViewSwitch board={board} />
        <FormDialog
          trigger={`Add ${role === "WORKER" ? "worker" : "receptionist"}`}
          title={`Add ${role === "WORKER" ? "worker" : "receptionist"}`}
          endpoint="/api/users"
          fields={[...fields, { name: "password", label: "Initial password (8+ characters)", type: "password", required: true }]}
          success="User added"
        />
      </PageHeader>
      {board ? <DataBoard columns={columns} empty="None" dropEndpoint="/api/users/:id" /> : <Section title={`All ${title.toLowerCase()}`}>
        <SimpleTable
          headers={role === "WORKER" ? ["Name", "Email", "Phone", "Active jobs", "Completed", "Status", "Actions"] : ["Name", "Email", "Phone", "Status", "Actions"]}
          rows={users.map((u) => [
            <TextLink key="n" href={`/admin/staff/${u.id}`}>{u.name}</TextLink>,
            u.email,
            u.phone ?? "—",
            ...(role === "WORKER" ? [u._count.assignedJobs, completed.find((c) => c.assignedWorkerId === u.id)?._count ?? 0] : []),
            u.active ? "Active" : "Inactive",
            <div key="a" className="flex gap-1.5">
              <FormDialog
                trigger="Edit"
                title={`Edit ${u.name}`}
                variant="outline"
                method="PATCH"
                endpoint={`/api/users/${u.id}`}
                initial={{ name: u.name, email: u.email, phone: u.phone, role: u.role, active: u.active }}
                fields={[...fields, { name: "password", label: "New password (leave blank to keep)", type: "password", omitEmpty: true }, { name: "active", label: "Active", type: "checkbox" }]}
              />
              {u.active && <ActionButton label="Deactivate" variant="ghost" method="DELETE" endpoint={`/api/users/${u.id}`} confirm={`Deactivate ${u.name}? They won't be able to log in.`} success="User deactivated" />}
            </div>,
          ])}
        />
      </Section>}
    </>
  );
}
