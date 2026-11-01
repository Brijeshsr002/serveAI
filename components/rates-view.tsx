import { Pencil } from "lucide-react";
import { FormDialog } from "@/components/actions";
import { PageHeader, Section, SimpleTable } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { money } from "@/lib/format";

/** For reception and workers: see the rates, ask an admin to change one, and put forward a new part. */
export async function RatesView() {
  const types = await db.serviceType.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const table = (rows: typeof types, noun: string) => (
    <SimpleTable
      headers={[noun, "Rate", "Change requested", ""]}
      empty={`No ${noun.toLowerCase()}s yet`}
      rowKeys={rows.map((t) => t.id)}
      rows={rows.map((t) => [
        t.name,
        t.rate ? money(t.rate) : "Not set",
        t.proposedRate ? `${money(t.proposedRate)} by ${t.proposedBy ?? "staff"}` : "—",
        <FormDialog
          key="e"
          trigger={<Pencil className="size-3.5" />}
          triggerLabel={`Change ${t.name} rate`}
          triggerSize="icon-sm"
          variant="ghost"
          title={`Change ${t.name} rate`}
          endpoint={`/api/service-types/${t.id}/rate`}
          fields={[{ name: "rate", label: "New rate (₹)", type: "number", required: true }]}
          initial={{ rate: t.proposedRate?.toString() ?? t.rate?.toString() }}
          submitLabel="Send to admin"
          success="Sent to admin for approval"
        />,
      ])}
    />
  );
  return (
    <>
      <PageHeader title="Service Rates" subtitle="Default prices for services and parts. An admin approves any change." />
      <div className="space-y-4">
        <Section title="Services">{table(types.filter((t) => t.kind === "SERVICE"), "Service")}</Section>
        <Section
          title="Parts"
          action={
            <FormDialog
              trigger="+ Add part"
              variant="outline"
              title="Add a part"
              endpoint="/api/service-types"
              extraBody={{ kind: "PART" }}
              fields={[
                { name: "name", label: "Name", required: true },
                { name: "rate", label: "Rate (₹)", type: "number", required: true },
              ]}
              submitLabel="Send to admin"
              success="Sent to admin for approval"
            />
          }
        >
          {table(types.filter((t) => t.kind === "PART"), "Part")}
        </Section>
      </div>
    </>
  );
}
