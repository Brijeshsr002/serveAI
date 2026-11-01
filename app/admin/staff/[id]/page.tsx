import { notFound } from "next/navigation";
import { FormDialog } from "@/components/actions";
import { staffProfileFields } from "@/components/forms-config";
import { EmployeeMonthReport } from "@/components/employees-view";
import { StaffInsights } from "@/components/staff-insights";
import { staffRoleLabel } from "@/components/team-attendance";
import { Field, PageHeader, Section, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { date, isMonthKey, istMonthKey } from "@/lib/format";
import { employeeRoleLabel } from "@/lib/services/employees";
import { getStaffProfile } from "@/lib/services/staff";

export default async function StaffProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ month?: string }> }) {
  await requireRole(["ADMIN"]);
  const staff = await getStaffProfile((await params).id);
  if (!staff) notFound();
  const asked = (await searchParams)?.month;
  const month = isMonthKey(asked) ? asked : istMonthKey(new Date());
  return (
    <>
      <PageHeader title={staff.name} subtitle={`${staffRoleLabel(staff)}${staff.active ? "" : " · Inactive"}`}>
        <FormDialog
          trigger="Edit profile"
          title={`Edit ${staff.name}`}
          method="PATCH"
          endpoint={`/api/users/${staff.id}/profile`}
          fields={staffProfileFields}
          onlyChanged
          initial={{
            role: staff.role,
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
      <p className="mb-4 text-sm"><TextLink href="/admin/employees">Back to Employees</TextLink></p>
      <div className="grid grid-cols-1 gap-4">
        <EmployeeMonthReport id={staff.id} month={month} />
        <Section title="Details">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Role">{employeeRoleLabel(staff.role)}</Field>
            <Field label="Job title">{staff.jobTitle}</Field>
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
