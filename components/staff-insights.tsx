import { StatusDot } from "@/components/team-attendance";
import { Section, SimpleTable, StatCard, StatusBadge, TextLink } from "@/components/ui-kit";
import { date, dayShort, duration, istMonthKey, monthLabel, money } from "@/lib/format";
import { personMonthSummary, recentDays } from "@/lib/services/attendance";
import { receptionPerformance, workerPerformance } from "@/lib/services/staff";

type Person = { id: string; role: string; active: boolean; startKey: string; salary: string | null };
type RecentJob = Awaited<ReturnType<typeof workerPerformance>>["recentJobs"][number];

function RecentJobs({ jobs, base }: { jobs: RecentJob[]; base: string }) {
  return (
    <SimpleTable
      headers={["Service", "Type", "Status", "Created"]}
      empty="No jobs yet"
      rows={jobs.map((j) => [
        <TextLink key="n" href={`${base}/jobs/${j.id}`}>{j.serviceNumber}</TextLink>,
        j.serviceType,
        <StatusBadge key="s" status={j.status} />,
        date(j.createdAt),
      ])}
    />
  );
}

async function WorkerPerformance({ id, base }: { id: string; base: string }) {
  const p = await workerPerformance(id);
  return (
    <Section title="Performance">
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Jobs completed this month" value={p.completedThisMonth} />
        <StatCard label="Jobs completed, all time" value={p.completedAllTime} />
        <StatCard label="Active jobs now" value={p.activeJobs} />
        <StatCard
          label="Average time to complete"
          value={p.averageCompletionMs === null ? "—" : duration(p.averageCompletionMs)}
          hint={p.timedJobs ? `Job created to completed, over ${p.timedJobs} job${p.timedJobs === 1 ? "" : "s"}` : undefined}
        />
        <StatCard label="Paid on completed jobs" value={money(p.revenue)} hint="Customer payments, all time" />
      </div>
      <RecentJobs jobs={p.recentJobs} base={base} />
    </Section>
  );
}

async function ReceptionPerformance({ id, base }: { id: string; base: string }) {
  const p = await receptionPerformance(id);
  return (
    <Section title="Performance">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard label="Jobs created this month" value={p.createdThisMonth} />
        <StatCard label="Jobs created, all time" value={p.createdAllTime} />
      </div>
      <RecentJobs jobs={p.recentJobs} base={base} />
    </Section>
  );
}

/** Attendance, performance and salary for one person. A server component: none of this reaches client props. */
export async function StaffInsights({ person, jobsBase, showNotes = false }: { person: Person; jobsBase: string; showNotes?: boolean }) {
  const month = istMonthKey(new Date());
  const [summary, days] = await Promise.all([personMonthSummary(person, month), recentDays(person)]);
  return (
    <div className="grid grid-cols-1 gap-4">
      <Section title={`Attendance, ${monthLabel(month)}`}>
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Days present" value={summary.present} />
          <StatCard label="Days on leave" value={summary.leave} hint={summary.upcomingLeave ? `${summary.upcomingLeave} more coming up` : undefined} />
          <StatCard label="Days absent" value={summary.absent ?? "—"} />
          <StatCard label="Days so far" value={summary.daysSoFar} />
        </div>
        {summary.todayPending && <p className="mb-3 text-xs text-muted-foreground">Today isn&apos;t counted as absent until the day is over.</p>}
        <h3 className="mb-1 text-sm font-medium">Recent days</h3>
        {days.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No attendance yet</p>}
        <ul className="divide-y text-sm">
          {days.map((d) => (
            <li key={d.date} className="flex items-center gap-2.5 py-1.5">
              <StatusDot status={d.status} />
              <span className="w-28 shrink-0">{dayShort(d.date)}</span>
              <span className="min-w-0 flex-1 text-muted-foreground">
                {d.label}
                {showNotes && d.note && <span className="block break-words text-xs">{d.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      {person.role === "WORKER" ? <WorkerPerformance id={person.id} base={jobsBase} /> : <ReceptionPerformance id={person.id} base={jobsBase} />}
      <Section title="Salary">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Monthly salary</dt>
            <dd className="text-lg font-semibold tabular-nums">{person.salary === null ? "Not set" : money(person.salary)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Days present this month</dt>
            <dd className="text-lg font-semibold tabular-nums">{summary.present} of {summary.daysSoFar} so far</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">Information only. This is not a pay calculation.</p>
      </Section>
    </div>
  );
}
