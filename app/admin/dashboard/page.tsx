import { ClockCard } from "@/components/clock-card";
import { LiveScene } from "@/components/live-scene";
import { TeamAttendanceCard } from "@/components/team-attendance";
import { CLIPS } from "@/lib/media-clips";
import { SingleBarChart, WorkerChart } from "@/components/charts";
import { Section,SimpleTable, StatCard, TextLink } from "@/components/ui-kit";
import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { chartData, dashboardStats, reportSummary } from "@/lib/services/reports";

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
        <div className="px-6 py-10 [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-white">Welcome back, {user.name}. {stats.vehiclesInService} vehicle{stats.vehiclesInService === 1 ? "" : "s"} in the garage right now.</p>
        </div>
      </LiveScene>
      {user.role === "RECEPTIONIST" && <ClockCard userId={user.id} />}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard tone="border-t-sky-500" label="Total Customers" value={stats.customers} />
        <StatCard tone="border-t-primary" label="Today's Services" value={stats.todayServices} />
        <StatCard tone="border-t-blue-600" label="Active Services" value={stats.activeServices} />
        <StatCard tone="border-t-green-600" label="Completed Today" value={stats.completedToday} />
        <StatCard tone="border-t-violet-500" label="Vehicles in Service" value={stats.vehiclesInService} />
        <StatCard tone="border-t-[#F7C96B]" label="Pending Payments" value={stats.pendingPayments} hint={money(stats.pendingAmount)} />
        {isAdmin && <StatCard tone="border-t-teal-600" label="Revenue" value={money(stats.revenue)} />}
      </div>
      <div className={cn("mb-6 grid grid-cols-1 items-start gap-4", isAdmin && "xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
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
        {isAdmin && <TeamAttendanceCard />}
      </div>
      {isAdmin && <AdminPanels />}
    </>
  );
}

async function AdminPanels() {
  const [summary, charts, activity] = await Promise.all([
    reportSummary(),
    chartData(),
    db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const exportLink = (type: string, label: string) => (
    <a key={type} className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/reports/export?type=${type}`}>{label}</a>
  );
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Reports</h2>
        <div className="flex flex-wrap gap-2">
          {exportLink("services", "Export services CSV")}
          {exportLink("payments", "Export payments CSV")}
          {exportLink("workers", "Export workers CSV")}
        </div>
      </div>
      {/* Services today, revenue and pending payments are already in the figures at the top of the page. */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Services (7 days)" value={summary.weekly} />
        <StatCard label="Services (30 days)" value={summary.monthly} />
        <StatCard label="Completed services" value={summary.completed} />
        <StatCard label="Cancelled services" value={summary.cancelled} />
        <StatCard label="Repeat customers" value={summary.repeatCustomers} />
      </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Services by status"><SingleBarChart data={charts.byStatus} label="Services" horizontal drill="status" /></Section>
      <Section title="Service type distribution"><SingleBarChart data={charts.byType} label="Services" horizontal drill="type" /></Section>
      <Section title="Daily revenue (last 14 days)"><SingleBarChart data={charts.dailyRevenue} label="Revenue" currency drill="day" /></Section>
      <Section title="Monthly revenue"><SingleBarChart data={charts.monthlyRevenue} label="Revenue" currency drill="month" /></Section>
      <Section title="Worker performance"><WorkerChart data={charts.workerPerformance} drill /></Section>
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
    </>
  );
}
