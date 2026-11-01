import { notFound } from "next/navigation";
import { FormDialog } from "@/components/actions";
import { StaffInsights } from "@/components/staff-insights";
import { staffRoleLabel } from "@/components/team-attendance";
import { Field, PageHeader, Section } from "@/components/ui-kit";
import { date } from "@/lib/format";
import { getOwnProfile } from "@/lib/services/staff";

/** Read-only, apart from the person's own password. staffNotes isn't even selected. */
export async function OwnProfile({ userId, jobsBase }: { userId: string; jobsBase: string }) {
  const me = await getOwnProfile(userId);
  if (!me) notFound();
  return (
    <>
      <PageHeader title="Profile">
        <FormDialog
          trigger="Change password"
          title="Change password"
          endpoint="/api/profile/password"
          success="Password changed"
          fields={[
            { name: "currentPassword", label: "Current password", type: "password", required: true },
            { name: "newPassword", label: "New password (8+ characters)", type: "password", required: true },
          ]}
        />
      </PageHeader>
      <div className="grid grid-cols-1 gap-4">
        <Section title="Your details">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">{me.name}</Field>
            <Field label="Job title">{staffRoleLabel(me)}</Field>
            <Field label="Email">{me.email}</Field>
            <Field label="Phone">{me.phone}</Field>
            <Field label="Joined on">{me.joinedOn && date(me.joinedOn)}</Field>
            <Field label="Emergency contact">{me.emergencyContact}</Field>
            <Field label="Address">{me.address}</Field>
          </dl>
        </Section>
        <StaffInsights person={me} jobsBase={jobsBase} />
      </div>
    </>
  );
}
