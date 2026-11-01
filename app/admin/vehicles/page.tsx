import { Pencil } from "lucide-react";
import { FormDialog } from "@/components/actions";
import { DataBoard, isBoardView, ViewSwitch } from "@/components/data-board";
import { vehicleFields } from "@/components/forms-config";
import { PageHeader, SearchForm, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { date } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { normalizeRegistration } from "@/lib/phone";
import { ACTIVE_STATUSES } from "@/lib/status";

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const { q, view } = await searchParams;
  const board = isBoardView(view);
  const term = q?.trim();
  const [vehicles, customers, inService] = await Promise.all([
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
    db.serviceJob.findMany({ where: { status: { in: ACTIVE_STATUSES } }, select: { vehicleId: true }, distinct: ["vehicleId"] }),
  ]);
  const inServiceIds = new Set(inService.map((j) => j.vehicleId));
  const customerField = {
    name: "customerId",
    label: "Customer",
    type: "select" as const,
    required: true,
    options: customers.map((c) => ({ value: c.id, label: `${c.name} · +${c.phone}` })),
  };
  const columns = [
    { key: "service", label: "In service", color: "bg-blue-100 text-blue-700", match: (v: (typeof vehicles)[number]) => inServiceIds.has(v.id) },
    { key: "past", label: "Serviced before", color: "bg-green-100 text-green-800", match: (v: (typeof vehicles)[number]) => !inServiceIds.has(v.id) && v._count.serviceJobs > 0 },
    { key: "new", label: "No service yet", color: "bg-slate-100 text-slate-700", match: (v: (typeof vehicles)[number]) => v._count.serviceJobs === 0 },
  ].map(({ match, ...col }) => ({
    ...col,
    cards: vehicles.filter(match).map((v) => ({
      id: v.id,
      title: <TextLink href={`${base}/vehicles/${v.id}`}>{v.registrationNumber}</TextLink>,
      actions: <FormDialog trigger={<Pencil className="size-3.5" />} triggerLabel={`Edit ${v.registrationNumber}`} triggerSize="icon-sm" variant="ghost" title={`Edit ${v.registrationNumber}`} method="PATCH" endpoint={`/api/vehicles/${v.id}`} fields={vehicleFields} initial={{ registrationNumber: v.registrationNumber, brand: v.brand, model: v.model, variant: v.variant, manufacturingYear: v.manufacturingYear, fuelType: v.fuelType, color: v.color, odometer: v.odometer }} success="Saved" />,
      lines: [`${v.brand} ${v.model}`, <TextLink key="c" href={`${base}/customers/${v.customer.id}`}>{v.customer.name}</TextLink>],
      left: `Last: ${date(v.serviceJobs[0]?.createdAt)}`,
      right: `${v._count.serviceJobs} service${v._count.serviceJobs === 1 ? "" : "s"}`,
    })),
  }));
  return (
    <>
      <PageHeader title="Vehicles" subtitle={`${vehicles.length} shown`}>
        <ViewSwitch board={board} q={q} />
        <FormDialog trigger="Add vehicle" title="Add vehicle" endpoint="/api/vehicles" fields={[customerField, ...vehicleFields]} success="Vehicle added" redirectTo={`${base}/vehicles/:id`} />
      </PageHeader>
      <SearchForm q={q} view={board ? undefined : "list"} placeholder="Search registration, brand or model" />
      {board ? <DataBoard columns={columns} empty="No vehicles" /> : <Section title="All vehicles">
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
      </Section>}
    </>
  );
}
