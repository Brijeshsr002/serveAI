import { LiveScene } from "@/components/live-scene";
import { CLIPS } from "@/lib/media-clips";
import { SingleBarChart, WorkerChart } from "@/components/charts";
import { Section,SimpleTable, StatCard, StatusBadge, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { chartData, dashboardStats } from "@/lib/services/reports";

export default async function DashboardPage() {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const isAdmin = user.role === "ADMIN";
  const stats = await dashboardStats();
  const unassigned = await db.serviceJob.findMany({
    where: { status: "NEW" },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { customer: { select: { name: true } }, vehicle: { select: { registrationNumber: true } } },
  });

  return (
    <>
      <LiveScene clips={CLIPS.garage} className="mb-5 rounded-2xl">
        <div className="px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-300">Welcome back, {user.name}. {stats.vehiclesInService} vehicle{stats.vehiclesInService === 1 ? "" : "s"} in the garage right now.</p>
        </div>
      </LiveScene>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard tone="border-t-sky-500" label="Total Customers" value={stats.customers} />
        <StatCard tone="border-t-orange-500" label="Today's Services" value={stats.todayServices} />
        <StatCard tone="border-t-blue-600" label="Active Services" value={stats.activeServices} />
        <StatCard tone="border-t-green-600" label="Completed Today" value={stats.completedToday} />
        <StatCard tone="border-t-violet-500" label="Vehicles in Service" value={stats.vehiclesInService} />
        <StatCard tone="border-t-amber-500" label="Pending Payments" value={stats.pendingPayments} hint={money(stats.pendingAmount)} />
        {isAdmin && <StatCard tone="border-t-teal-600" label="Revenue" value={money(stats.revenue)} />}
      </div>
      <div className="mb-6">
        <Section title="New requests awaiting assignment">
          <SimpleTable
            headers={["Service", "Customer", "Vehicle", "Type", "Received"]}
            empty="No new requests"
            rows={unassigned.map((j) => [
              <TextLink key="n" href={`${base}/jobs/${j.id}`}>{j.serviceNumber}</TextLink>,
              j.customer.name,
              j.vehicle.registrationNumber,
              j.serviceType,
              dateTime(j.createdAt),
            ])}
          />
        </Section>
      </div>
      {isAdmin && <AdminPanels />}
    </>
  );
}

async function AdminPanels() {
  const [charts, activity] = await Promise.all([
    chartData(),
    db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Services by status"><SingleBarChart data={charts.byStatus} label="Services" horizontal /></Section>
      <Section title="Service type distribution"><SingleBarChart data={charts.byType} label="Services" horizontal /></Section>
      <Section title="Daily revenue (last 14 days)"><SingleBarChart data={charts.dailyRevenue} label="Revenue" currency /></Section>
      <Section title="Monthly revenue"><SingleBarChart data={charts.monthlyRevenue} label="Revenue" currency /></Section>
      <Section title="Worker performance"><WorkerChart data={charts.workerPerformance} /></Section>
      <Section title="Recent activity">
        <ul className="space-y-2 text-sm">
          {activity.map((a) => (
            <li key={a.id} className="flex justify-between gap-3">
              <span>{a.summary}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{dateTime(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
