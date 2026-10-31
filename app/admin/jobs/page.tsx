import Link from "next/link";
import type { Prisma, ServiceStatus } from "@prisma/client";
import { NewJobDialog } from "@/components/job-form";
import { PageHeader, SearchForm, Section, SimpleTable, StatusBadge, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { normalizeRegistration } from "@/lib/phone";
import { workersWithLoad } from "@/lib/services/jobs";
import { STATUS_LABEL, STATUSES } from "@/lib/status";
import { cn } from "@/lib/utils";

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const { q, status } = await searchParams;
  const term = q?.trim();
  const reg = term ? normalizeRegistration(term) : "";
  const where: Prisma.ServiceJobWhereInput = {
    ...(status && STATUSES.includes(status as ServiceStatus) ? { status: status as ServiceStatus } : {}),
    ...(term
      ? {
          OR: [
            { serviceNumber: { contains: term, mode: "insensitive" } },
            { customer: { name: { contains: term, mode: "insensitive" } } },
            ...(reg ? [{ vehicle: { registrationNumber: { contains: reg } } }] : []),
          ],
        }
      : {}),
  };
  const [jobs, customers, types, workers] = await Promise.all([
    db.serviceJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        customer: { select: { name: true } },
        vehicle: { select: { brand: true, model: true, registrationNumber: true } },
        assignedWorker: { select: { name: true } },
      },
    }),
    db.customer.findMany({ orderBy: { name: "asc" }, take: 500, include: { vehicles: true } }),
    db.serviceType.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    workersWithLoad(),
  ]);
  return (
    <>
      <PageHeader title="Service Jobs" subtitle={`${jobs.length} shown`}>
        <NewJobDialog
          base={base}
          workers={workers}
          serviceTypes={types.map((t) => t.name)}
          customers={customers.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            vehicles: c.vehicles.map((v) => ({ id: v.id, label: `${v.registrationNumber} · ${v.brand} ${v.model}` })),
          }))}
        />
      </PageHeader>
      <SearchForm q={q} placeholder="Search service number, customer, registration" />
      <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
        {[undefined, ...STATUSES].map((s) => (
          <Link key={s ?? "all"} href={s ? `?status=${s}` : "?"} className={cn("rounded-full border px-2.5 py-1 hover:bg-accent", status === s && "border-primary text-primary")}>
            {s ? STATUS_LABEL[s] : "All"}
          </Link>
        ))}
      </div>
      <Section title="Jobs">
        <SimpleTable
          headers={["Service", "Customer", "Vehicle", "Type", "Status", "Worker", "Estimate", "Created"]}
          empty="No service jobs match"
          rows={jobs.map((j) => [
            <TextLink key="s" href={`${base}/jobs/${j.id}`}>{j.serviceNumber}</TextLink>,
            j.customer.name,
            <div key="v">{j.vehicle.registrationNumber}<div className="text-xs text-muted-foreground">{j.vehicle.brand} {j.vehicle.model}</div></div>,
            j.serviceType,
            <StatusBadge key="b" status={j.status} />,
            j.assignedWorker?.name ?? <span key="w" className="text-amber-700">Unassigned</span>,
            money(j.estimatedAmount),
            dateTime(j.createdAt),
          ])}
        />
      </Section>
    </>
  );
}
