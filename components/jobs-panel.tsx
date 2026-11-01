import Link from "next/link";
import type { Prisma, ServiceStatus } from "@prisma/client";
import { isBoardView, ViewSwitch } from "@/components/data-board";
import { JobBoard } from "@/components/job-board";
import { NewJobDialog } from "@/components/job-form";
import { SearchForm, Section, SimpleTable, StatusBadge, TextLink } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { normalizeRegistration } from "@/lib/phone";
import { workersWithLoad } from "@/lib/services/jobs";
import { ACTIVE_STATUSES, STATUS_LABEL, STATUSES, TERMINAL } from "@/lib/status";
import { cn } from "@/lib/utils";

const jobInclude = {
  customer: { select: { name: true } },
  vehicle: { select: { brand: true, model: true, registrationNumber: true } },
  assignedWorker: { select: { name: true } },
} satisfies Prisma.ServiceJobInclude;

/** Open jobs oldest first, as they are the next to deal with; closed columns only need recent history. */
const loadBoardJobs = (where: Prisma.ServiceJobWhereInput) =>
  Promise.all([
    db.serviceJob.findMany({ where: { ...where, status: { in: ACTIVE_STATUSES } }, orderBy: { createdAt: "asc" }, take: 300, include: jobInclude }),
    ...TERMINAL.map((s) => db.serviceJob.findMany({ where: { ...where, status: s }, orderBy: { updatedAt: "desc" }, take: 25, include: jobInclude })),
  ]).then((groups) => groups.flat());

/** The Jobs board tab of Customers & Jobs. */
export async function JobsPanel({ base, q, status, view }: { base: string; q?: string; status?: string; view?: string }) {
  const board = isBoardView(view);
  const term = q?.trim();
  const reg = term ? normalizeRegistration(term) : "";
  const where: Prisma.ServiceJobWhereInput = {
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
  const listWhere: Prisma.ServiceJobWhereInput = {
    ...where,
    ...(status && STATUSES.includes(status as ServiceStatus) ? { status: status as ServiceStatus } : {}),
  };
  const [jobs, statusCounts, customers, types, workers] = await Promise.all([
    board
      ? loadBoardJobs(where)
      : db.serviceJob.findMany({ where: listWhere, orderBy: { createdAt: "desc" }, take: 100, include: jobInclude }),
    board ? db.serviceJob.groupBy({ by: ["status"], where, _count: true }) : [],
    db.customer.findMany({ orderBy: { name: "asc" }, take: 500, include: { vehicles: true } }),
    db.serviceType.findMany({ where: { active: true, kind: "SERVICE" }, orderBy: { name: "asc" } }),
    workersWithLoad(),
  ]);
  const counts = Object.fromEntries(statusCounts.map((c) => [c.status, c._count]));
  const rates = Object.fromEntries(types.filter((t) => t.rate !== null).map((t) => [t.name, Number(t.rate)]));
  return {
    subtitle: board ? `${statusCounts.reduce((sum, c) => sum + c._count, 0)} jobs in total` : `${jobs.length} jobs shown`,
    actions: (
      <>
        <ViewSwitch board={board} q={q} />
        <NewJobDialog
          base={base}
          workers={workers}
          serviceTypes={types.map((t) => t.name)}
          rates={rates}
          customers={customers.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            vehicles: c.vehicles.map((v) => ({ id: v.id, label: `${v.registrationNumber} · ${v.brand} ${v.model}` })),
          }))}
        />
      </>
    ),
    body: (
      <>
        <SearchForm q={q} view={board ? undefined : "list"} placeholder="Filter jobs by service number, customer, registration" />
      {board ? (
        <JobBoard
          base={base}
          counts={counts}
          workers={workers}
          serviceTypes={types.map((t) => t.name)}
          rates={rates}
          jobs={jobs.map((j) => ({
            id: j.id,
            serviceNumber: j.serviceNumber,
            serviceType: j.serviceType,
            status: j.status,
            priority: j.priority,
            customerName: j.customer.name,
            registrationNumber: j.vehicle.registrationNumber,
            vehicleName: `${j.vehicle.brand} ${j.vehicle.model}`,
            workerId: j.assignedWorkerId,
            workerName: j.assignedWorker?.name ?? null,
            estimate: money(j.estimatedAmount),
            appointment: j.appointmentDate ? dateTime(j.appointmentDate) : null,
            edit: {
              customerComplaint: j.customerComplaint,
              internalNotes: j.internalNotes,
              estimatedAmount: j.estimatedAmount?.toString() ?? null,
              appointmentDate: j.appointmentDate?.toISOString() ?? null,
              expectedCompletion: j.expectedCompletion?.toISOString() ?? null,
            },
          }))}
        />
      ) : (
        <>
      <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
        {[undefined, ...STATUSES].map((s) => (
          <Link key={s ?? "all"} href={`?${new URLSearchParams({ view: "list", ...(s ? { status: s } : {}), ...(q ? { q } : {}) })}`} className={cn("rounded-full border px-2.5 py-1 hover:bg-accent", status === s && "border-primary text-primary")}>
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
      )}
      </>
    ),
  };
}
