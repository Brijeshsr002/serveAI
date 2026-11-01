import { Pencil } from "lucide-react";
import { ActionButton, FormDialog } from "@/components/actions";
import { DataBoard, isBoardView, ViewSwitch } from "@/components/data-board";
import { PageHeader, Section, SimpleTable } from "@/components/ui-kit";
import { db } from "@/lib/db";

export default async function ServiceTypesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const board = isBoardView((await searchParams).view);
  const types = await db.serviceType.findMany({ orderBy: { name: "asc" } });
  const fields = [
    { name: "name", label: "Name", required: true },
    { name: "description", label: "Description" },
  ];
  const columns = [
    { key: "active", label: "Active", color: "bg-green-100 text-green-800", active: true, drop: { active: true } },
    { key: "hidden", label: "Hidden", color: "bg-slate-100 text-slate-700", active: false, drop: { active: false } },
  ].map(({ active, ...col }) => ({
    ...col,
    cards: types.filter((t) => t.active === active).map((t) => ({
      id: t.id,
      title: t.name,
      actions: <FormDialog trigger={<Pencil className="size-3.5" />} triggerLabel={`Edit ${t.name}`} triggerSize="icon-sm" variant="ghost" title={`Edit ${t.name}`} method="PATCH" endpoint={`/api/service-types/${t.id}`} fields={fields} initial={{ name: t.name, description: t.description }} success="Saved" />,
      lines: t.description ? [t.description] : [],
      footer: <ActionButton label={t.active ? "Hide" : "Show"} variant="outline" method="PATCH" endpoint={`/api/service-types/${t.id}`} body={{ active: !t.active }} className="mt-1 w-full" />,
    })),
  }));
  return (
    <>
      <PageHeader title="Service Types">
        <ViewSwitch board={board} />
        <FormDialog trigger="Add type" title="Add service type" endpoint="/api/service-types" fields={fields} success="Service type added" />
      </PageHeader>
      {board ? <DataBoard columns={columns} empty="None" dropEndpoint="/api/service-types/:id" /> : <Section title="All service types">
        <SimpleTable
          headers={["Name", "Description", "Status", "Actions"]}
          rows={types.map((t) => [
            t.name,
            t.description ?? "—",
            t.active ? "Active" : "Hidden",
            <div key="a" className="flex gap-1.5">
              <FormDialog trigger="Edit" title={`Edit ${t.name}`} variant="outline" method="PATCH" endpoint={`/api/service-types/${t.id}`} fields={fields} initial={{ name: t.name, description: t.description }} />
              <ActionButton label={t.active ? "Hide" : "Show"} variant="ghost" method="PATCH" endpoint={`/api/service-types/${t.id}`} body={{ active: !t.active }} />
            </div>,
          ])}
        />
      </Section>}
    </>
  );
}
