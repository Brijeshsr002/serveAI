import { ActionButton, FormDialog } from "@/components/actions";
import { PageHeader, Section, SimpleTable } from "@/components/ui-kit";
import { db } from "@/lib/db";

export default async function ServiceTypesPage() {
  const types = await db.serviceType.findMany({ orderBy: { name: "asc" } });
  const fields = [
    { name: "name", label: "Name", required: true },
    { name: "description", label: "Description" },
  ];
  return (
    <>
      <PageHeader title="Service Types">
        <FormDialog trigger="Add type" title="Add service type" endpoint="/api/service-types" fields={fields} success="Service type added" />
      </PageHeader>
      <Section title="All service types">
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
      </Section>
    </>
  );
}
