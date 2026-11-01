import type { PaymentStatus } from "@prisma/client";
import { Download } from "lucide-react";
import { ActionButton } from "@/components/actions";
import { DataBoard, isBoardView, PageTabs, pickTab, ViewSwitch } from "@/components/data-board";
import { PageHeader, PaymentBadge, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { date, dateTime, money } from "@/lib/format";
import { invoiceInclude, invoicePaymentStatus } from "@/lib/services/invoices";
import { PAYMENT_COLOR } from "@/lib/status";

const PAYMENT_COLUMNS: PaymentStatus[] = ["PENDING", "PROCESSING", "PAID", "FAILED", "REFUNDED", "CANCELLED"];
const REMINDABLE: PaymentStatus[] = ["PENDING", "PROCESSING"];
const PAYMENTS_NOTE = "Status changes only come from verified payment-provider webhooks";

function DownloadLink({ id, number }: { id: string; number: string }) {
  return (
    <a href={`/api/invoices/${id}/pdf`} aria-label={`Download ${number}`} title={`Download ${number}`} className="inline-flex size-7 items-center justify-center rounded-md text-primary hover:bg-accent">
      <Download className="size-3.5" />
    </a>
  );
}

async function paymentsPanel(base: string, board: boolean) {
  const payments = await db.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { customer: { select: { name: true } }, serviceJob: { select: { id: true, serviceNumber: true } } },
  });
  type Row = (typeof payments)[number];
  const reminder = (p: Row, className?: string) =>
    REMINDABLE.includes(p.status) && p.paymentLink ? (
      <ActionButton
        label="Send reminder"
        variant="outline"
        endpoint={`/api/payments/${p.id}/remind`}
        confirm={`Send ${p.customer.name} a WhatsApp reminder for ${money(p.amount)} on ${p.serviceJob.serviceNumber}? It uses the same payment link.`}
        success="Reminder sent on WhatsApp"
        className={className}
      />
    ) : null;

  if (board) {
    const columns = PAYMENT_COLUMNS.map((s) => ({
      key: s,
      label: s.charAt(0) + s.slice(1).toLowerCase(),
      color: PAYMENT_COLOR[s],
      cards: payments.filter((p) => p.status === s).map((p) => ({
        id: p.id,
        title: <TextLink href={`${base}/jobs/${p.serviceJob.id}`}>{p.serviceJob.serviceNumber}</TextLink>,
        lines: [p.customer.name, p.paidAt ? `Paid ${dateTime(p.paidAt)}` : `Created ${dateTime(p.createdAt)}`],
        left: p.paymentProvider,
        right: <strong>{money(p.amount)}</strong>,
        footer: reminder(p, "mt-1 w-full"),
      })),
    }));
    return <DataBoard columns={columns} empty="No payments" />;
  }
  return (
    <Section title="All payments">
      <SimpleTable
        headers={["Service", "Customer", "Amount", "Provider", "Status", "Paid", "Created", ""]}
        empty="No payments yet. Create one from a service job."
        rowKeys={payments.map((p) => p.id)}
        rows={payments.map((p) => [
          <TextLink key="s" href={`${base}/jobs/${p.serviceJob.id}`}>{p.serviceJob.serviceNumber}</TextLink>,
          p.customer.name,
          money(p.amount),
          p.paymentProvider,
          <PaymentBadge key="b" status={p.status} />,
          dateTime(p.paidAt),
          dateTime(p.createdAt),
          reminder(p),
        ])}
      />
    </Section>
  );
}

async function invoicesPanel(board: boolean) {
  const invoices = await db.invoice.findMany({ orderBy: { invoiceDate: "desc" }, take: 200, include: invoiceInclude });
  type Row = (typeof invoices)[number];
  const send = (i: Row, className?: string) => (
    <ActionButton
      label="Send on WhatsApp"
      variant="outline"
      endpoint={`/api/invoices/${i.id}/send`}
      confirm={`Send invoice ${i.invoiceNumber} to ${i.serviceJob.customer.name} on WhatsApp?`}
      success="Invoice sent on WhatsApp"
      className={className}
    />
  );

  if (board) {
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
        footer: send(i, "mt-1 w-full"),
      })),
    }));
    return <DataBoard columns={columns} empty="No invoices" />;
  }
  return (
    <Section title="All invoices">
      <SimpleTable
        headers={["Invoice", "Service", "Customer", "Total", "Payment", "Date", ""]}
        empty="No invoices yet. Generate one from a service job."
        rowKeys={invoices.map((i) => i.id)}
        rows={invoices.map((i) => [
          <TextLink key="i" href={`/admin/invoices/${i.id}`}>{i.invoiceNumber}</TextLink>,
          <TextLink key="s" href={`/admin/jobs/${i.serviceJobId}`}>{i.serviceJob.serviceNumber}</TextLink>,
          i.serviceJob.customer.name,
          money(i.total),
          <PaymentBadge key="b" status={invoicePaymentStatus(i)} />,
          date(i.invoiceDate),
          <div key="a" className="flex items-center gap-1.5"><DownloadLink id={i.id} number={i.invoiceNumber} />{send(i)}</div>,
        ])}
      />
    </Section>
  );
}

/** Payments and invoices on one page. Invoices are admin-only, so reception never gets the tab or its query, whatever the URL says. */
export async function BillingView({ base, withInvoices, tab: asked, view }: { base: string; withInvoices: boolean; tab?: unknown; view?: unknown }) {
  const board = isBoardView(view);
  const tab = withInvoices ? pickTab(asked, ["payments", "invoices"] as const) : "payments";
  const panel = tab === "payments" ? await paymentsPanel(base, board) : await invoicesPanel(board);
  return (
    <>
      <PageHeader title="Billing" subtitle={tab === "payments" ? PAYMENTS_NOTE : undefined}>
        <ViewSwitch board={board} keep={withInvoices ? { tab } : undefined} />
      </PageHeader>
      {withInvoices && (
        <PageTabs label="Billing" param="tab" active={tab} keep={board ? {} : { view: "list" }} tabs={[{ key: "payments", label: "Payments" }, { key: "invoices", label: "Invoices" }]} />
      )}
      {panel}
    </>
  );
}
