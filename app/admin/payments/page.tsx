import { PageHeader, PaymentBadge, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";

export default async function PaymentsPage() {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const payments = await db.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { customer: { select: { name: true } }, serviceJob: { select: { id: true, serviceNumber: true } } },
  });
  return (
    <>
      <PageHeader title="Payments" subtitle="Status changes only come from verified payment-provider webhooks" />
      <Section title="All payments">
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
      </Section>
    </>
  );
}
