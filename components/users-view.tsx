import { ActionButton, FormDialog } from "@/components/actions";
import { userFields } from "@/components/forms-config";
import { PageHeader, Section, SimpleTable } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { ACTIVE_STATUSES } from "@/lib/status";

export async function UsersView({ role, title }: { role: "WORKER" | "RECEPTIONIST"; title: string }) {
  const users = await db.user.findMany({
    where: { role },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          assignedJobs: { where: { status: { in: ACTIVE_STATUSES } } },
        },
      },
    },
  });
  const completed = await db.serviceJob.groupBy({ by: ["assignedWorkerId"], where: { status: "COMPLETED" }, _count: true });
  const fields = userFields(role);
  return (
    <>
      <PageHeader title={title}>
        <FormDialog
          trigger={`Add ${role === "WORKER" ? "worker" : "receptionist"}`}
          title={`Add ${role === "WORKER" ? "worker" : "receptionist"}`}
          endpoint="/api/users"
          fields={[...fields, { name: "password", label: "Initial password (8+ characters)", type: "password", required: true }]}
          success="User added"
        />
      </PageHeader>
      <Section title={`All ${title.toLowerCase()}`}>
        <SimpleTable
          headers={role === "WORKER" ? ["Name", "Email", "Phone", "Active jobs", "Completed", "Status", "Actions"] : ["Name", "Email", "Phone", "Status", "Actions"]}
          rows={users.map((u) => [
            u.name,
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
      </Section>
    </>
  );
}
