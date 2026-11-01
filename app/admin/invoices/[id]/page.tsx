import { notFound } from "next/navigation";
import { ActionButton } from "@/components/actions";
import { Field, PageHeader, PaymentBadge, Section, SimpleTable } from "@/components/ui-kit";
import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { date, money } from "@/lib/format";
import { invoiceInclude, invoicePaymentStatus } from "@/lib/services/invoices";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const { id } = await params;
  const invoice = await db.invoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!invoice) notFound();
  const job = invoice.serviceJob;
  return (
    <>
      <PageHeader title={invoice.invoiceNumber} subtitle={date(invoice.invoiceDate)}>
        <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/invoices/${invoice.id}/pdf`}>Download PDF</a>
        <ActionButton label="Send on WhatsApp" endpoint={`/api/invoices/${invoice.id}/send`} success="Invoice sent" />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Summary">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Service">{job.serviceNumber}</Field>
            <Field label="Payment"><PaymentBadge status={invoicePaymentStatus(invoice)} /></Field>
            <Field label="Customer">{job.customer.name}</Field>
            <Field label="Vehicle">{job.vehicle.registrationNumber}</Field>
            <Field label="Labour">{money(invoice.labourTotal)}</Field>
            <Field label="Parts">{money(invoice.partsTotal)}</Field>
            <Field label="Subtotal">{money(invoice.subtotal)}</Field>
            <Field label="Tax">{money(invoice.tax)}</Field>
            <Field label="Discount">{money(invoice.discount)}</Field>
            <Field label="Total">{money(invoice.total)}</Field>
          </dl>
        </Section>
        <div className="lg:col-span-2">
          <Section title="Items">
            <SimpleTable
              headers={["Item", "Type", "Qty", "Price", "Tax", "Discount", "Total"]}
              rows={invoice.items.map((i) => [i.name, i.itemType.toLowerCase(), Number(i.quantity), money(i.unitPrice), money(i.tax), money(i.discount), money(i.total)])}
            />
          </Section>
        </div>
      </div>
    </>
  );
}
