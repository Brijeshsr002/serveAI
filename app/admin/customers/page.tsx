import { Pencil } from "lucide-react";
import { FormDialog } from "@/components/actions";
import { DataBoard, type DataCard, isBoardView, ViewSwitch } from "@/components/data-board";
import { customerFields } from "@/components/forms-config";
import { PageHeader, PaymentBadge, SearchForm, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { date } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { customerSearchWhere } from "@/lib/services/customers";
import { ACTIVE_STATUSES } from "@/lib/status";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const { q, view } = await searchParams;
  const board = isBoardView(view);
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
  const column = (c: (typeof customers)[number]) => {
    if (c._count.serviceJobs > 0) return "active";
    if (c.payments[0] && ["PENDING", "PROCESSING"].includes(c.payments[0].status)) return "due";
    return c.serviceJobs[0] ? "past" : "new";
  };
  const card = (c: (typeof customers)[number]): DataCard => ({
    id: c.id,
    title: <TextLink href={`${base}/customers/${c.id}`}>{c.name}</TextLink>,
    actions: <FormDialog trigger={<Pencil className="size-3.5" />} triggerLabel={`Edit ${c.name}`} triggerSize="icon-sm" variant="ghost" title={`Edit ${c.name}`} method="PATCH" endpoint={`/api/customers/${c.id}`} fields={customerFields} initial={{ name: c.name, phone: `+${c.phone}`, email: c.email, address: c.address, city: c.city, notes: c.notes }} success="Saved" />,
    lines: [`+${c.phone}`, `${c._count.vehicles} vehicle${c._count.vehicles === 1 ? "" : "s"} · last service ${date(c.serviceJobs[0]?.createdAt)}`],
    left: c.customerCode,
    right: <TextLink href={`${base}/whatsapp?c=${c.id}`}>Message</TextLink>,
  });
  const columns = [
    { key: "new", label: "New", color: "bg-slate-100 text-slate-700" },
    { key: "active", label: "In service", color: "bg-blue-100 text-blue-700" },
    { key: "due", label: "Payment due", color: "bg-amber-100 text-amber-800" },
    { key: "past", label: "Past customers", color: "bg-green-100 text-green-800" },
  ].map((col) => ({ ...col, cards: customers.filter((c) => column(c) === col.key).map(card) }));
  return (
    <>
      <PageHeader title="Customers" subtitle={`${customers.length} shown`}>
        <ViewSwitch board={board} q={q} />
        <FormDialog trigger="+ Add customer" title="Add customer" endpoint="/api/customers" fields={customerFields} success="Customer added" redirectTo={`${base}/customers/:id`} />
      </PageHeader>
      <SearchForm q={q} view={board ? undefined : "list"} placeholder="Search name, phone, vehicle number, customer ID" />
      {board ? <DataBoard columns={columns} empty="No customers" /> : <Section title="All customers">
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
      </Section>}
    </>
  );
}
