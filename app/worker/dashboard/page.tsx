import { ClockCard } from "@/components/clock-card";
import { PageHeader, StatCard } from "@/components/ui-kit";
import { WorkerJobCard } from "@/components/worker-job-card";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { addDays, startOfDayIST } from "@/lib/format";
import { billCatalog } from "@/lib/services/service-rates";
import { ACTIVE_STATUSES } from "@/lib/status";

const include = {
  customer: { select: { name: true } },
  vehicle: { select: { brand: true, model: true, registrationNumber: true } },
  items: { orderBy: { createdAt: "asc" } },
  payments: { select: { status: true } },
} as const;

export default async function WorkerDashboard() {
  const user = await requireRole(["WORKER"]);
  const catalog = await billCatalog();
  const today = startOfDayIST();
  const tomorrow = addDays(today, 1);
  const jobs = await db.serviceJob.findMany({
    where: { assignedWorkerId: user.id, status: { in: ACTIVE_STATUSES } },
    orderBy: [{ appointmentDate: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    include,
  });
  const completed = await db.serviceJob.count({ where: { assignedWorkerId: user.id, status: "COMPLETED" } });
  // No appointment means it's ready to work on now, so it counts as today.
  const isUpcoming = (d: Date | null) => Boolean(d && d >= tomorrow);
  const todays = jobs.filter((j) => !isUpcoming(j.appointmentDate));
  const upcoming = jobs.filter((j) => isUpcoming(j.appointmentDate));
  return (
    <>
      <PageHeader title="My Jobs" subtitle={`Hi ${user.name}`} />
      <ClockCard userId={user.id} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Today's Jobs" value={todays.length} />
        <StatCard label="In Progress" value={jobs.filter((j) => j.status === "SERVICE_IN_PROGRESS").length} />
        <StatCard label="Ready for Delivery" value={jobs.filter((j) => j.status === "READY_FOR_DELIVERY").length} />
        <StatCard label="Completed" value={completed} />
      </div>
      <h2 className="mb-2 font-medium">Today</h2>
      {todays.length === 0 && <p className="mb-4 text-sm text-muted-foreground">No jobs for today</p>}
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{todays.map((j) => <WorkerJobCard key={j.id} job={j} catalog={catalog} />)}</div>
      {upcoming.length > 0 && (
        <>
          <h2 className="mb-2 font-medium">Upcoming</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{upcoming.map((j) => <WorkerJobCard key={j.id} job={j} catalog={catalog} />)}</div>
        </>
      )}
    </>
  );
}
