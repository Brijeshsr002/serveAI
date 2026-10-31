import { FormDialog } from "@/components/actions";
import { Field, PageHeader, Section } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";

export default async function ProfilePage() {
  const user = await requireRole(["WORKER"]);
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
      <div className="max-w-md">
        <Section title="Your details">
          <dl className="space-y-3">
            <Field label="Name">{user.name}</Field>
            <Field label="Email">{user.email}</Field>
            <Field label="Phone">{user.phone}</Field>
          </dl>
        </Section>
      </div>
    </>
  );
}
