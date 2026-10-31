import { FormDialog } from "@/components/actions";
import { customerFields } from "@/components/forms-config";
import { PageHeader, PaymentBadge, SearchForm, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { date } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { customerSearchWhere } from "@/lib/services/customers";
import { ACTIVE_STATUSES } from "@/lib/status";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const { q } = await searchParams;
  const customers = await db.customer.findMany({
    where: customerSearchWhere(q),
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      _count: { select: { vehicles: true, serviceJobs: { where: { status: { in: ACTIVE_STATUSES } } } } },
      serviceJobs: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      payments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
    },
  });
  return (
    <>
      <PageHeader title="Customers" subtitle={`${customers.length} shown`}>
        <FormDialog trigger="+ Add customer" title="Add customer" endpoint="/api/customers" fields={customerFields} success="Customer added" redirectTo={`${base}/customers/:id`} />
      </PageHeader>
      <SearchForm q={q} placeholder="Search name, phone, vehicle number, customer ID" />
      <Section title="All customers">
        <SimpleTable
          headers={["Customer", "Phone", "Vehicles", "Active Services", "Last Service", "Payment Status", "Actions"]}
          empty="No customers match"
          rows={customers.map((c) => [
            <div key="n"><TextLink href={`${base}/customers/${c.id}`}>{c.name}</TextLink><div className="text-xs text-muted-foreground">{c.customerCode}</div></div>,
            `+${c.phone}`,
            c._count.vehicles,
            c._count.serviceJobs,
            date(c.serviceJobs[0]?.createdAt),
            c.payments[0] ? <PaymentBadge key="p" status={c.payments[0].status} /> : "—",
            <TextLink key="a" href={`${base}/whatsapp?c=${c.id}`}>Message</TextLink>,
          ])}
        />
      </Section>
    </>
  );
}
