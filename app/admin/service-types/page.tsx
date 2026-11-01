import type { ServiceTypeKind } from "@prisma/client";
import { ActionButton, FormDialog } from "@/components/actions";
import { PageTabs, pickTab } from "@/components/data-board";
import { PageHeader, Section, SimpleTable } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Who the draft prices are filed under until an admin reviews them. See the review_draft_rates migration. */
const STARTING_PRICE = "Starting price";

const KINDS = { service: "SERVICE", part: "PART" } as const satisfies Record<string, ServiceTypeKind>;
const RATE_FIELD = { name: "rate", label: "Rate (₹)", type: "number" as const, placeholder: "Leave blank for no rate" };

function RateDecision({ type: t }: { type: { id: string; proposedRate: unknown; proposedBy: string | null } }) {
  if (t.proposedRate === null) return <span className="text-muted-foreground">—</span>;
  const endpoint = `/api/service-types/${t.id}/rate/decision`;
  const proposedRate = String(t.proposedRate);
  return (
    <div className="my-1 space-y-1 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
      <p>{t.proposedBy === STARTING_PRICE ? `${STARTING_PRICE}: ${money(t.proposedRate as number)}` : `${t.proposedBy ?? "Staff"} asked for ${money(t.proposedRate as number)}`}</p>
      <div className="flex gap-1">
        <ActionButton label="Approve" endpoint={endpoint} body={{ approve: true, proposedRate }} success="Rate updated" />
        <ActionButton label="Reject" variant="ghost" endpoint={endpoint} body={{ approve: false, proposedRate }} success="Request rejected" />
      </div>
    </div>
  );
}

export default async function ServiceTypesPage({ searchParams }: { searchParams: Promise<{ kind?: string | string[] }> }) {
  await requireRole(["ADMIN"]);
  const { kind } = await searchParams;
  const tab = pickTab(kind, ["service", "part"] as const);
  const types = await db.serviceType.findMany({ orderBy: { name: "asc" } });
  const fields = [
    { name: "name", label: "Name", required: true },
    { name: "description", label: "Description" },
  ];
  const rateButton = (t: (typeof types)[number]) => (
    <FormDialog trigger="Set rate" variant="outline" title={`Set ${t.name} rate`} endpoint={`/api/service-types/${t.id}/rate`} fields={[{ name: "rate", label: "Rate (₹)", type: "number", required: true }]} initial={{ rate: t.rate?.toString() }} success="Rate updated" />
  );
  const rows = types.filter((t) => t.kind === KINDS[tab]);
  // A request on the tab that isn't open must not go unnoticed.
  const waiting = (key: keyof typeof KINDS) => {
    const count = types.filter((t) => t.kind === KINDS[key] && t.proposedRate !== null).length;
    return count ? `${count} waiting` : undefined;
  };
  return (
    <>
      <PageHeader title="Service Types" subtitle="Services can be booked and put on jobs. Parts are only priced for the bill.">
        <FormDialog trigger="+ Add service" title="Add service type" endpoint="/api/service-types" fields={[...fields, RATE_FIELD]} extraBody={{ kind: "SERVICE" }} success="Service type added" />
        <FormDialog trigger="+ Add part" variant="outline" title="Add part" endpoint="/api/service-types" fields={[...fields, RATE_FIELD]} extraBody={{ kind: "PART" }} success="Part added" />
      </PageHeader>
      <PageTabs
        label="Services and parts"
        param="kind"
        active={tab}
        tabs={[{ key: "service", label: "Services", note: waiting("service") }, { key: "part", label: "Parts", note: waiting("part") }]}
      />
      <Section title={tab === "service" ? "All services" : "All parts"}>
        <SimpleTable
          headers={["Name", "Rate", "Change requested", "Status", "Actions"]}
          empty="None yet"
          rowKeys={rows.map((t) => t.id)}
          rows={rows.map((t) => [
            <div key="n">{t.name}{t.description && <div className="max-w-64 text-xs break-words whitespace-normal text-muted-foreground">{t.description}</div>}</div>,
            t.rate ? money(t.rate) : "Not set",
            <RateDecision key="r" type={t} />,
            <span key="s" className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", t.active ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700")}>{t.active ? "Active" : "Hidden"}</span>,
            <div key="a" className="flex gap-1.5">
              <FormDialog trigger="Edit" title={`Edit ${t.name}`} variant="outline" method="PATCH" endpoint={`/api/service-types/${t.id}`} fields={fields} initial={{ name: t.name, description: t.description }} />
              {rateButton(t)}
              <ActionButton label={t.active ? "Hide" : "Show"} variant="ghost" method="PATCH" endpoint={`/api/service-types/${t.id}`} body={{ active: !t.active }} />
            </div>,
          ])}
        />
      </Section>
    </>
  );
}
