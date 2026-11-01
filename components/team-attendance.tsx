import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dayHeading } from "@/lib/format";
import { teamDay, type DayStatus, type TeamDay } from "@/lib/services/attendance";
import { cn } from "@/lib/utils";

const DOT: Record<DayStatus, string> = {
  PRESENT: "bg-green-500",
  LEAVE: "bg-[#F7C96B]",
  ABSENT: "bg-red-500",
  NONE: "bg-slate-300",
};

export function StatusDot({ status }: { status: DayStatus }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", DOT[status])} />;
}

export const staffRoleLabel = (u: { role: string; jobTitle?: string | null }) =>
  u.jobTitle || (u.role === "WORKER" ? "Worker" : "Receptionist");

export function AttendanceCounts({ day }: { day: TeamDay }) {
  const total = day.present + day.leave + day.absent;
  const parts: { status: DayStatus; label: string; count: number }[] = [
    { status: "PRESENT", label: "Present", count: day.present },
    { status: "LEAVE", label: "On Leave", count: day.leave },
    { status: "ABSENT", label: "Absent", count: day.absent },
  ];
  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {parts.map((p) => (
          <span key={p.status} className="flex items-center gap-1.5">
            <StatusDot status={p.status} />
            <span className="font-semibold tabular-nums">{p.count}</span>
            <span className="text-muted-foreground">{p.label}</span>
          </span>
        ))}
      </div>
      <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((p) => `${p.count} ${p.label}`).join(", ")}>
        {total > 0 && parts.filter((p) => p.count > 0).map((p) => (
          <span key={p.status} className={DOT[p.status]} style={{ width: `${(p.count / total) * 100}%` }} />
        ))}
      </div>
    </>
  );
}

/** Admin dashboard only: it names everyone's attendance. */
export async function TeamAttendanceCard() {
  const day = await teamDay();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Attendance</CardTitle>
        <p className="text-xs font-medium tracking-wide text-muted-foreground">{dayHeading(day.date)}</p>
      </CardHeader>
      <CardContent>
        <AttendanceCounts day={day} />
        {day.entries.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No active staff yet</p>}
        <ul className="mt-3 divide-y">
          {day.entries.map((e) => (
            <li key={e.userId}>
              <Link href={`/admin/staff/${e.userId}`} className="flex items-center gap-2.5 py-2 text-sm hover:bg-accent/50">
                <StatusDot status={e.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium" title={e.name}>{e.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{staffRoleLabel(e)}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">{e.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/admin/attendance" className="mt-3 block text-sm font-medium text-primary hover:underline">View full attendance</Link>
      </CardContent>
    </Card>
  );
}
