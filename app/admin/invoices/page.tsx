import { DataBoard, isBoardView, ViewSwitch } from "@/components/data-board";
import { PageHeader, PaymentBadge, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { date, money } from "@/lib/format";
import { invoiceInclude, invoicePaymentStatus } from "@/lib/services/invoices";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const board = isBoardView((await searchParams).view);
  const invoices = await db.invoice.findMany({ orderBy: { invoiceDate: "desc" }, take: 200, include: invoiceInclude });
  const columns = [
    { key: "unpaid", label: "Unpaid", color: "bg-slate-100 text-slate-700", statuses: ["UNPAID", "FAILED", "CANCELLED"] },
    { key: "pending", label: "Payment pending", color: "bg-amber-100 text-amber-800", statuses: ["PENDING", "PROCESSING"] },
    { key: "paid", label: "Paid", color: "bg-green-100 text-green-800", statuses: ["PAID"] },
    { key: "refunded", label: "Refunded", color: "bg-violet-100 text-violet-700", statuses: ["REFUNDED"] },
  ].map(({ statuses, ...col }) => ({
    ...col,
    cards: invoices.filter((i) => statuses.includes(invoicePaymentStatus(i))).map((i) => ({
      id: i.id,
      title: <TextLink href={`/admin/invoices/${i.id}`}>{i.invoiceNumber}</TextLink>,
      lines: [i.serviceJob.customer.name, <TextLink key="s" href={`/admin/jobs/${i.serviceJobId}`}>{i.serviceJob.serviceNumber}</TextLink>],
      left: date(i.invoiceDate),
      right: <strong>{money(i.total)}</strong>,
    })),
  }));
  return (
    <>
      <PageHeader title="Invoices"><ViewSwitch board={board} /></PageHeader>
      {board ? <DataBoard columns={columns} empty="No invoices" /> : <Section title="All invoices">
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
      </Section>}
    </>
  );
}
