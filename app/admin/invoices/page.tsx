import { PageHeader, PaymentBadge, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { date, money } from "@/lib/format";
import { invoiceInclude, invoicePaymentStatus } from "@/lib/services/invoices";

export default async function InvoicesPage() {
  const invoices = await db.invoice.findMany({ orderBy: { invoiceDate: "desc" }, take: 200, include: invoiceInclude });
  return (
    <>
      <PageHeader title="Invoices" />
      <Section title="All invoices">
        <SimpleTable
          headers={["Invoice", "Service", "Customer", "Total", "Payment", "Date"]}
          empty="No invoices yet. Generate one from a service job."
          rows={invoices.map((i) => [
            <TextLink key="i" href={`/admin/invoices/${i.id}`}>{i.invoiceNumber}</TextLink>,
            <TextLink key="s" href={`/admin/jobs/${i.serviceJobId}`}>{i.serviceJob.serviceNumber}</TextLink>,
            i.serviceJob.customer.name,
            money(i.total),
            <PaymentBadge key="b" status={invoicePaymentStatus(i)} />,
            date(i.invoiceDate),
          ])}
        />
      </Section>
    </>
  );
}
