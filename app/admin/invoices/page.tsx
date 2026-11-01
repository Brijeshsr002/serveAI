import { Download } from "lucide-react";
import { DataBoard, isBoardView, ViewSwitch } from "@/components/data-board";
import { PageHeader, PaymentBadge, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { date, money } from "@/lib/format";
import { invoiceInclude, invoicePaymentStatus } from "@/lib/services/invoices";

function DownloadLink({ id, number }: { id: string; number: string }) {
  return (
    <a href={`/api/invoices/${id}/pdf`} aria-label={`Download ${number}`} title={`Download ${number}`} className="inline-flex size-7 items-center justify-center rounded-md text-primary hover:bg-accent">
      <Download className="size-3.5" />
    </a>
  );
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireRole(["ADMIN"]);
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
      actions: <DownloadLink id={i.id} number={i.invoiceNumber} />,
    })),
  }));
  return (
    <>
      <PageHeader title="Invoices"><ViewSwitch board={board} /></PageHeader>
      {board ? <DataBoard columns={columns} empty="No invoices" /> : <Section title="All invoices">
        <SimpleTable
          headers={["Invoice", "Service", "Customer", "Total", "Payment", "Date", ""]}
          empty="No invoices yet. Generate one from a service job."
          rows={invoices.map((i) => [
            <TextLink key="i" href={`/admin/invoices/${i.id}`}>{i.invoiceNumber}</TextLink>,
            <TextLink key="s" href={`/admin/jobs/${i.serviceJobId}`}>{i.serviceJob.serviceNumber}</TextLink>,
            i.serviceJob.customer.name,
            money(i.total),
            <PaymentBadge key="b" status={invoicePaymentStatus(i)} />,
            date(i.invoiceDate),
            <DownloadLink key="d" id={i.id} number={i.invoiceNumber} />,
          ])}
        />
      </Section>}
    </>
  );
}
