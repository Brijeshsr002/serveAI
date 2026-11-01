import type { ServiceTypeKind } from "@prisma/client";
import { Pencil } from "lucide-react";
import { ActionButton, FormDialog } from "@/components/actions";
import { DataBoard, isBoardView, ViewSwitch } from "@/components/data-board";
import { PageHeader, Section, SimpleTable } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { money } from "@/lib/format";

/** Who the draft prices are filed under until an admin reviews them. See the review_draft_rates migration. */
const STARTING_PRICE = "Starting price";

function RateDecision({ type: t }: { type: { id: string; proposedRate: unknown; proposedBy: string | null } }) {
  if (t.proposedRate === null) return null;
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

export default async function ServiceTypesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireRole(["ADMIN"]);
  const board = isBoardView((await searchParams).view);
  const types = await db.serviceType.findMany({ orderBy: { name: "asc" } });
  const fields = [
    { name: "name", label: "Name", required: true },
    { name: "description", label: "Description" },
  ];
  type Type = (typeof types)[number];
  const rateButton = (t: Type) => (
    <FormDialog trigger="Set rate" variant="outline" title={`Set ${t.name} rate`} endpoint={`/api/service-types/${t.id}/rate`} fields={[{ name: "rate", label: "Rate (₹)", type: "number", required: true }]} initial={{ rate: t.rate?.toString() }} success="Rate updated" />
  );
  const catalog = (kind: ServiceTypeKind) => {
    const rows = types.filter((t) => t.kind === kind);
    const columns = [
      { key: "waiting", label: "Rate change requested", color: "bg-amber-100 text-amber-800", match: (t: Type) => t.proposedRate !== null },
      { key: "active", label: "Active", color: "bg-green-100 text-green-800", drop: { active: true }, match: (t: Type) => t.active && t.proposedRate === null },
      { key: "hidden", label: "Hidden", color: "bg-slate-100 text-slate-700", drop: { active: false }, match: (t: Type) => !t.active && t.proposedRate === null },
    ].map(({ match, ...col }) => ({
      ...col,
      cards: rows.filter(match).map((t) => ({
        id: t.id,
        // The waiting column follows the request alone, so a card can't leave it until the request is decided.
        dropTo: t.proposedRate !== null ? [] : undefined,
        title: t.name,
        actions: <FormDialog trigger={<Pencil className="size-3.5" />} triggerLabel={`Edit ${t.name}`} triggerSize="icon-sm" variant="ghost" title={`Edit ${t.name}`} method="PATCH" endpoint={`/api/service-types/${t.id}`} fields={fields} initial={{ name: t.name, description: t.description }} success="Saved" />,
        lines: t.description ? [t.description] : [],
        right: <strong>{t.rate ? money(t.rate) : "No rate"}</strong>,
        left: rateButton(t),
        footer: <><RateDecision type={t} /><ActionButton label={t.active ? "Hide" : "Show"} variant="outline" method="PATCH" endpoint={`/api/service-types/${t.id}`} body={{ active: !t.active }} className="mt-1 w-full" /></>,
      })),
    }));
    return board ? (
      <DataBoard columns={columns} empty="None" dropEndpoint="/api/service-types/:id" />
    ) : (
      <SimpleTable
        headers={["Name", "Rate", "Change requested", "Status", "Actions"]}
        empty="None yet"
        rowKeys={rows.map((t) => t.id)}
        rows={rows.map((t) => [
          t.name,
          t.rate ? money(t.rate) : "Not set",
          <RateDecision key="r" type={t} />,
          t.active ? "Active" : "Hidden",
          <div key="a" className="flex gap-1.5">
            <FormDialog trigger="Edit" title={`Edit ${t.name}`} variant="outline" method="PATCH" endpoint={`/api/service-types/${t.id}`} fields={fields} initial={{ name: t.name, description: t.description }} />
            {rateButton(t)}
            <ActionButton label={t.active ? "Hide" : "Show"} variant="ghost" method="PATCH" endpoint={`/api/service-types/${t.id}`} body={{ active: !t.active }} />
          </div>,
        ])}
      />
    );
  };
  return (
    <>
      <PageHeader title="Service Types" subtitle="Services can be booked and put on jobs. Parts are only priced for the bill.">
        <ViewSwitch board={board} />
        <FormDialog trigger="+ Add service" title="Add service type" endpoint="/api/service-types" fields={fields} extraBody={{ kind: "SERVICE" }} success="Service type added" />
        <FormDialog trigger="+ Add part" variant="outline" title="Add part" endpoint="/api/service-types" fields={[...fields, { name: "rate", label: "Rate (₹)", type: "number" }]} extraBody={{ kind: "PART" }} success="Part added" />
      </PageHeader>
      <div className="space-y-4">
        <Section title="Services">{catalog("SERVICE")}</Section>
        <Section title="Parts">{catalog("PART")}</Section>
      </div>
    </>
  );
}
