import { SingleBarChart, WorkerChart } from "@/components/charts";
import { PageHeader, Section, StatCard } from "@/components/ui-kit";
import { buttonVariants } from "@/components/ui/button";
import { money } from "@/lib/format";
import { chartData, reportSummary } from "@/lib/services/reports";

export default async function ReportsPage() {
  const [s, charts] = await Promise.all([reportSummary(), chartData()]);
  const exportLink = (type: string, label: string) => (
    <a key={type} className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/reports/export?type=${type}`}>{label}</a>
  );
  return (
    <>
      <PageHeader title="Reports">
        {exportLink("services", "Export services CSV")}
        {exportLink("payments", "Export payments CSV")}
        {exportLink("workers", "Export workers CSV")}
      </PageHeader>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Services today" value={s.daily} />
        <StatCard label="Services (7 days)" value={s.weekly} />
        <StatCard label="Services (30 days)" value={s.monthly} />
        <StatCard label="Revenue" value={money(s.revenue)} />
        <StatCard label="Pending payments" value={money(s.pendingAmount)} />
        <StatCard label="Completed services" value={s.completed} />
        <StatCard label="Cancelled services" value={s.cancelled} />
        <StatCard label="Repeat customers" value={s.repeatCustomers} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Daily revenue (last 14 days)"><SingleBarChart data={charts.dailyRevenue} label="Revenue" currency /></Section>
        <Section title="Monthly revenue"><SingleBarChart data={charts.monthlyRevenue} label="Revenue" currency /></Section>
        <Section title="Most common service types"><SingleBarChart data={charts.byType} label="Services" horizontal /></Section>
        <Section title="Worker performance"><WorkerChart data={charts.workerPerformance} /></Section>
      </div>
    </>
  );
}
