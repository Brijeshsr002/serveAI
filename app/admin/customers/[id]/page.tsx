import { notFound } from "next/navigation";
import { ActionButton, FormDialog } from "@/components/actions";
import { customerFields, vehicleFields } from "@/components/forms-config";
import { Field, PageHeader, PaymentBadge, Section, SimpleTable, StatusBadge, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { date, dateTime, money } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const { id } = await params;
  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      vehicles: { orderBy: { createdAt: "asc" } },
      serviceJobs: { orderBy: { createdAt: "desc" }, include: { vehicle: { select: { registrationNumber: true } }, invoice: true } },
      payments: { orderBy: { createdAt: "desc" }, include: { serviceJob: { select: { id: true, serviceNumber: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!customer) notFound();
  const invoices = customer.serviceJobs.flatMap((j) => (j.invoice ? [{ ...j.invoice, serviceNumber: j.serviceNumber }] : []));

  return (
    <>
      <PageHeader title={customer.name} subtitle={customer.customerCode}>
        <FormDialog trigger="+ Add vehicle" title="Add vehicle" variant="outline" endpoint="/api/vehicles" fields={[{ name: "customerId", label: "Customer", type: "select", options: [{ value: customer.id, label: customer.name }] }, ...vehicleFields]} success="Vehicle added" />
        <FormDialog trigger="Edit" title="Edit customer" variant="outline" method="PATCH" endpoint={`/api/customers/${customer.id}`} fields={customerFields} initial={{ name: customer.name, phone: `+${customer.phone}`, email: customer.email, address: customer.address, city: customer.city, notes: customer.notes }} />
        {user.role === "ADMIN" && <ActionButton label="Delete" variant="destructive" method="DELETE" endpoint={`/api/customers/${customer.id}`} confirm={`Delete ${customer.name}? This cannot be undone.`} success="Customer deleted" />}
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Customer information">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Phone">+{customer.phone}</Field>
            <Field label="Email">{customer.email}</Field>
            <Field label="City">{customer.city}</Field>
            <Field label="Address">{customer.address}</Field>
            <div className="col-span-2"><Field label="Notes">{customer.notes}</Field></div>
          </dl>
        </Section>
        <div className="lg:col-span-2">
          <Section title="Vehicles">
            <SimpleTable
              headers={["Registration", "Vehicle", "Year", "Fuel"]}
              empty="No vehicles yet"
              rows={customer.vehicles.map((v) => [
                <TextLink key="r" href={`${base}/vehicles/${v.id}`}>{v.registrationNumber}</TextLink>,
                `${v.brand} ${v.model}`,
                v.manufacturingYear ?? "—",
                v.fuelType ?? "—",
              ])}
            />
          </Section>
        </div>
        <div className="lg:col-span-2">
          <Section title="Service history">
            <SimpleTable
              headers={["Service", "Vehicle", "Type", "Status", "Created"]}
              empty="No services yet"
              rows={customer.serviceJobs.map((j) => [
                <TextLink key="s" href={`${base}/jobs/${j.id}`}>{j.serviceNumber}</TextLink>,
                j.vehicle.registrationNumber,
                j.serviceType,
                <StatusBadge key="b" status={j.status} />,
                date(j.createdAt),
              ])}
            />
          </Section>
        </div>
        <Section title="WhatsApp" action={<TextLink href={`${base}/whatsapp?c=${customer.id}`}>Open chat</TextLink>}>
          {customer.messages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet</p>}
          <ul className="space-y-2 text-sm">
            {customer.messages.map((m) => (
              <li key={m.id}>
                <span className="line-clamp-2">{m.direction === "INBOUND" ? "← " : "→ "}{m.content}</span>
                <span className="text-xs text-muted-foreground">{dateTime(m.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <div className="lg:col-span-2">
          <Section title="Payments">
            <SimpleTable
              headers={["Service", "Amount", "Status", "Paid"]}
              empty="No payments yet"
              rows={customer.payments.map((p) => [
                <TextLink key="s" href={`${base}/jobs/${p.serviceJob.id}`}>{p.serviceJob.serviceNumber}</TextLink>,
                money(p.amount),
                <PaymentBadge key="b" status={p.status} />,
                dateTime(p.paidAt),
              ])}
            />
          </Section>
        </div>
        <Section title="Invoices">
          <SimpleTable
            headers={["Invoice", "Total"]}
            empty="No invoices yet"
            rows={invoices.map((i) => [<a key="i" className="font-medium text-primary hover:underline" href={`/api/invoices/${i.id}/pdf`}>{i.invoiceNumber}</a>, money(i.total)])}
          />
        </Section>
      </div>
    </>
  );
}
