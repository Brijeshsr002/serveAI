import { FormDialog } from "@/components/actions";
import { vehicleFields } from "@/components/forms-config";
import { PageHeader, SearchForm, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { date } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { normalizeRegistration } from "@/lib/phone";

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const { q } = await searchParams;
  const term = q?.trim();
  const [vehicles, customers] = await Promise.all([
    db.vehicle.findMany({
      where: term
        ? {
            OR: [
              { registrationNumber: { contains: normalizeRegistration(term) || "__none__" } },
              { brand: { contains: term, mode: "insensitive" } },
              { model: { contains: term, mode: "insensitive" } },
            ],
          }
        : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        customer: { select: { id: true, name: true } },
        serviceJobs: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        _count: { select: { serviceJobs: true } },
      },
    }),
    db.customer.findMany({ orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, phone: true } }),
  ]);
  const customerField = {
    name: "customerId",
    label: "Customer",
    type: "select" as const,
    required: true,
    options: customers.map((c) => ({ value: c.id, label: `${c.name} · +${c.phone}` })),
  };
  return (
    <>
      <PageHeader title="Vehicles" subtitle={`${vehicles.length} shown`}>
        <FormDialog trigger="Add vehicle" title="Add vehicle" endpoint="/api/vehicles" fields={[customerField, ...vehicleFields]} success="Vehicle added" redirectTo={`${base}/vehicles/:id`} />
      </PageHeader>
      <SearchForm q={q} placeholder="Search registration, brand or model" />
      <Section title="All vehicles">
        <SimpleTable
          headers={["Registration", "Brand", "Model", "Customer", "Last service", "Total services"]}
          empty="No vehicles match"
          rows={vehicles.map((v) => [
            <TextLink key="r" href={`${base}/vehicles/${v.id}`}>{v.registrationNumber}</TextLink>,
            v.brand,
            v.model,
            <TextLink key="c" href={`${base}/customers/${v.customer.id}`}>{v.customer.name}</TextLink>,
            date(v.serviceJobs[0]?.createdAt),
            v._count.serviceJobs,
          ])}
        />
      </Section>
    </>
  );
}
