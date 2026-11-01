import { Pencil } from "lucide-react";
import { FormDialog } from "@/components/actions";
import { PageHeader, Section, SimpleTable } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { money } from "@/lib/format";

/** For reception and workers: see the rates, and ask an admin to change one. */
export async function RatesView() {
  const types = await db.serviceType.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Service Rates" subtitle="These are the default prices for new enquiries. An admin approves any change." />
      <Section title="All services">
        <SimpleTable
          headers={["Service", "Rate", "Change requested", ""]}
          rows={types.map((t) => [
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
      </Section>
    </>
  );
}
