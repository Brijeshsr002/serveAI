import { notFound } from "next/navigation";
import { FormDialog } from "@/components/actions";
import { vehicleFields } from "@/components/forms-config";
import { Field, PageHeader, Section, SimpleTable, StatusBadge, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { date } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { isTerminal } from "@/lib/status";

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const { id } = await params;
  const vehicle = await db.vehicle.findUnique({
    where: { id },
    include: { customer: true, serviceJobs: { orderBy: { createdAt: "desc" } } },
  });
  if (!vehicle) notFound();
  const current = vehicle.serviceJobs.find((j) => !isTerminal(j.status));
  return (
    <>
      <PageHeader title={vehicle.registrationNumber} subtitle={`${vehicle.brand} ${vehicle.model}`}>
        <FormDialog trigger="Edit" title="Edit vehicle" variant="outline" method="PATCH" endpoint={`/api/vehicles/${vehicle.id}`} fields={vehicleFields} initial={{ registrationNumber: vehicle.registrationNumber, brand: vehicle.brand, model: vehicle.model, variant: vehicle.variant, manufacturingYear: vehicle.manufacturingYear, fuelType: vehicle.fuelType, color: vehicle.color, odometer: vehicle.odometer }} />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Vehicle">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Customer"><TextLink href={`${base}/customers/${vehicle.customer.id}`}>{vehicle.customer.name}</TextLink></Field>
            <Field label="Variant">{vehicle.variant}</Field>
            <Field label="Year">{vehicle.manufacturingYear}</Field>
            <Field label="Fuel">{vehicle.fuelType}</Field>
            <Field label="Colour">{vehicle.color}</Field>
            <Field label="Odometer">{vehicle.odometer ? `${vehicle.odometer} km` : null}</Field>
            <Field label="Last service">{date(vehicle.serviceJobs[0]?.createdAt)}</Field>
            <Field label="Total services">{vehicle.serviceJobs.length}</Field>
            <Field label="Current service">{current ? <TextLink href={`${base}/jobs/${current.id}`}>{current.serviceNumber}</TextLink> : null}</Field>
          </dl>
        </Section>
        <div className="lg:col-span-2">
          <Section title="Service history">
            <SimpleTable
              headers={["Date", "Service", "Type", "Status"]}
              empty="No services yet"
              rows={vehicle.serviceJobs.map((j) => [
                date(j.createdAt),
                <TextLink key="s" href={`${base}/jobs/${j.id}`}>{j.serviceNumber}</TextLink>,
                j.serviceType,
                <StatusBadge key="b" status={j.status} />,
              ])}
            />
          </Section>
        </div>
      </div>
    </>
  );
}
