import { notFound } from "next/navigation";
import { FormDialog } from "@/components/actions";
import { staffProfileFields } from "@/components/forms-config";
import { StaffInsights } from "@/components/staff-insights";
import { staffRoleLabel } from "@/components/team-attendance";
import { Field, PageHeader, Section, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { date } from "@/lib/format";
import { getStaffProfile } from "@/lib/services/staff";

export default async function StaffProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const staff = await getStaffProfile((await params).id);
  if (!staff) notFound();
  const list = staff.role === "WORKER" ? { href: "/admin/workers", label: "Workers" } : { href: "/admin/receptionists", label: "Receptionists" };
  return (
    <>
      <PageHeader title={staff.name} subtitle={`${staffRoleLabel(staff)}${staff.active ? "" : " · Inactive"}`}>
        <FormDialog
          trigger="Edit profile"
          title={`Edit ${staff.name}`}
          method="PATCH"
          endpoint={`/api/users/${staff.id}/profile`}
          fields={staffProfileFields}
          initial={{
            name: staff.name,
            phone: staff.phone,
            email: staff.email,
            jobTitle: staff.jobTitle,
            salary: staff.salary,
            joinedOn: staff.joinedOn,
            address: staff.address,
            emergencyContact: staff.emergencyContact,
            staffNotes: staff.staffNotes,
            active: staff.active,
          }}
        />
      </PageHeader>
      <p className="mb-4 text-sm"><TextLink href={list.href}>Back to {list.label}</TextLink></p>
      <div className="grid grid-cols-1 gap-4">
        <Section title="Details">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Email">{staff.email}</Field>
            <Field label="Phone">{staff.phone}</Field>
            <Field label="Joined on">{staff.joinedOn && date(staff.joinedOn)}</Field>
            <Field label="Emergency contact">{staff.emergencyContact}</Field>
            <Field label="Address">{staff.address}</Field>
            <Field label="Notes (admin only)">{staff.staffNotes}</Field>
          </dl>
        </Section>
        <StaffInsights person={staff} jobsBase="/admin" showNotes />
      </div>
    </>
  );
}
