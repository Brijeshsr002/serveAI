import { Pencil } from "lucide-react";
import { FormDialog } from "@/components/actions";
import { PageTabs, pickTab } from "@/components/data-board";
import { PageHeader, Section, SimpleTable } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { money } from "@/lib/format";

/** For reception and workers: see the rates, ask an admin to change one, and put forward a new part. */
export async function RatesView({ kind }: { kind?: unknown }) {
  const tab = pickTab(kind, ["service", "part"] as const);
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
      <PageHeader title="Service Rates" subtitle="Default prices for services and parts. An admin approves any change.">
        <FormDialog
          trigger="+ Add part"
          variant="outline"
          title="Add a part"
          endpoint="/api/service-types"
          extraBody={{ kind: "PART" }}
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "rate", label: "Rate (₹), sent to an admin for approval", type: "number", placeholder: "Leave blank for no rate" },
          ]}
          submitLabel="Add part"
          success="Part added. Any rate goes to an admin for approval."
        />
      </PageHeader>
      <PageTabs label="Services and parts" param="kind" active={tab} tabs={[{ key: "service", label: "Services" }, { key: "part", label: "Parts" }]} />
      {tab === "service"
        ? <Section title="All services">{table(types.filter((t) => t.kind === "SERVICE"), "Service")}</Section>
        : <Section title="All parts">{table(types.filter((t) => t.kind === "PART"), "Part")}</Section>}
    </>
  );
}
