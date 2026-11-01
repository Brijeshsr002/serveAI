import { DataBoard, isBoardView, ViewSwitch } from "@/components/data-board";
import { PageHeader, PaymentBadge, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { PAYMENT_COLOR } from "@/lib/status";
import type { PaymentStatus } from "@prisma/client";

const PAYMENT_COLUMNS: PaymentStatus[] = ["PENDING", "PROCESSING", "PAID", "FAILED", "REFUNDED", "CANCELLED"];

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const board = isBoardView((await searchParams).view);
  const payments = await db.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { customer: { select: { name: true } }, serviceJob: { select: { id: true, serviceNumber: true } } },
  });
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
    })),
  }));
  return (
    <>
      <PageHeader title="Payments" subtitle="Status changes only come from verified payment-provider webhooks"><ViewSwitch board={board} /></PageHeader>
      {board ? <DataBoard columns={columns} empty="No payments" /> : <Section title="All payments">
        <SimpleTable
          headers={["Service", "Customer", "Amount", "Provider", "Status", "Paid", "Created"]}
          empty="No payments yet. Create one from a service job."
          rows={payments.map((p) => [
            <TextLink key="s" href={`${base}/jobs/${p.serviceJob.id}`}>{p.serviceJob.serviceNumber}</TextLink>,
            p.customer.name,
            money(p.amount),
            p.paymentProvider,
            <PaymentBadge key="b" status={p.status} />,
            dateTime(p.paidAt),
            dateTime(p.createdAt),
          ])}
        />
      </Section>}
    </>
  );
}
