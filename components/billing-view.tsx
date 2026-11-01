import type { PaymentStatus } from "@prisma/client";
import { Download } from "lucide-react";
import { ActionButton } from "@/components/actions";
import { PageTabs, pickTab } from "@/components/data-board";
import { PageHeader, PaymentBadge, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { date, dateTime, money } from "@/lib/format";
import { invoiceInclude, invoicePaymentStatus } from "@/lib/services/invoices";

const REMINDABLE: PaymentStatus[] = ["PENDING", "PROCESSING"];
const PAYMENTS_NOTE = "Status changes only come from verified payment-provider webhooks";

function DownloadLink({ id, number }: { id: string; number: string }) {
  return (
    <a href={`/api/invoices/${id}/pdf`} aria-label={`Download ${number}`} title={`Download ${number}`} className="inline-flex size-7 items-center justify-center rounded-md text-primary hover:bg-accent">
      <Download className="size-3.5" />
    </a>
  );
}

async function paymentsPanel(base: string) {
  const payments = await db.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { customer: { select: { name: true } }, serviceJob: { select: { id: true, serviceNumber: true } } },
  });
  type Row = (typeof payments)[number];
  const reminder = (p: Row) =>
    REMINDABLE.includes(p.status) && p.paymentLink ? (
      <ActionButton
        label="Send reminder"
        variant="outline"
        endpoint={`/api/payments/${p.id}/remind`}
        confirm={`Send ${p.customer.name} a WhatsApp reminder for ${money(p.amount)} on ${p.serviceJob.serviceNumber}? It uses the same payment link.`}
        success="Reminder sent on WhatsApp"
      />
    ) : null;

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

async function invoicesPanel() {
  const invoices = await db.invoice.findMany({ orderBy: { invoiceDate: "desc" }, take: 200, include: invoiceInclude });
  type Row = (typeof invoices)[number];
  const send = (i: Row) => (
    <ActionButton
      label="Send on WhatsApp"
      variant="outline"
      endpoint={`/api/invoices/${i.id}/send`}
      confirm={`Send invoice ${i.invoiceNumber} to ${i.serviceJob.customer.name} on WhatsApp?`}
      success="Invoice sent on WhatsApp"
    />
  );

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

/** Payments and invoices on one page, as tables. Invoices are admin-only, so reception never gets the tab or its query, whatever the URL says. */
export async function BillingView({ base, withInvoices, tab: asked }: { base: string; withInvoices: boolean; tab?: unknown }) {
  const tab = withInvoices ? pickTab(asked, ["payments", "invoices"] as const) : "payments";
  const panel = tab === "payments" ? await paymentsPanel(base) : await invoicesPanel();
  return (
    <>
      <PageHeader title="Billing" subtitle={tab === "payments" ? PAYMENTS_NOTE : undefined} />
      {withInvoices && (
        <PageTabs label="Billing" param="tab" active={tab} tabs={[{ key: "payments", label: "Payments" }, { key: "invoices", label: "Invoices" }]} />
      )}
      {panel}
    </>
  );
}
