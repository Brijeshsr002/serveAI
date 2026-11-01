import Link from "next/link";
import { ActionButton, FormDialog } from "@/components/actions";
import { attendanceNoteField } from "@/components/forms-config";
import { AttendanceCounts, staffRoleLabel, StatusDot } from "@/components/team-attendance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { addDayKey, dayHeading, isDayKey, monthLabel } from "@/lib/format";
import { teamDay, teamMonthSummaries, todayKey } from "@/lib/services/attendance";

const MARK = "/api/attendance/mark";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  await requireRole(["ADMIN"]);
  const requested = (await searchParams).date;
  const today = todayKey();
  const date = isDayKey(requested) ? requested : today;
  const month = date.slice(0, 7);
  const [day, summaries] = await Promise.all([teamDay(date), teamMonthSummaries(month)]);
  const dayLink = "rounded-lg border bg-card px-2.5 py-1 text-sm hover:bg-accent";

  return (
    <>
      <PageHeader title="Attendance" subtitle={dayHeading(date)}>
        <Link className={dayLink} href={`?date=${addDayKey(date, -1)}`}>Previous day</Link>
        {date !== today && <Link className={dayLink} href="?">Today</Link>}
        <Link className={dayLink} href={`?date=${addDayKey(date, 1)}`}>Next day</Link>
        <form method="get" className="flex gap-2">
          <Input type="date" name="date" defaultValue={date} aria-label="Date" className="w-auto" />
          <Button type="submit" size="sm" variant="outline">Go</Button>
        </form>
      </PageHeader>
      <div className="grid grid-cols-1 gap-4">
        <Section title="Team">
          <div className="mb-4"><AttendanceCounts day={day} /></div>
          <SimpleTable
            headers={["Name", "Role", "Status", "Note", "Actions"]}
            empty="No staff on this date"
            rowKeys={day.entries.map((e) => e.userId)}
            rows={day.entries.map((e) => {
              const body = { userId: e.userId, date };
              return [
                <TextLink key="n" href={`/admin/staff/${e.userId}`}>{e.name}</TextLink>,
                `${staffRoleLabel(e)}${e.active ? "" : " · Inactive"}`,
                <span key="s" className="flex items-center gap-2 whitespace-nowrap"><StatusDot status={e.status} /> {e.label}</span>,
                e.note ? <span key="t" className="block max-w-64 break-words whitespace-pre-line">{e.note}</span> : "—",
                <div key="a" className="flex flex-wrap gap-1.5">
                  {e.status !== "LEAVE" && !e.clockInAt && (
                    <FormDialog trigger="Mark leave" variant="outline" title={`${e.name}: on leave ${date}`} endpoint={MARK} extraBody={{ ...body, action: "leave" }} fields={attendanceNoteField} success="Marked on leave" />
                  )}
                  {e.status !== "PRESENT" && date <= today && (
                    <FormDialog trigger="Mark present" variant="outline" title={`${e.name}: present ${date}`} endpoint={MARK} extraBody={{ ...body, action: "present" }} fields={attendanceNoteField} success="Marked present" />
                  )}
                  {(e.status === "PRESENT" || e.status === "LEAVE") && (
                    <ActionButton label="Clear" variant="ghost" endpoint={MARK} body={{ ...body, action: "clear" }} confirm={`Clear ${e.name}'s record for ${date}? Any clock times are removed.`} success="Cleared" />
                  )}
                </div>,
              ];
            })}
          />
        </Section>
        <Section title={`Month summary, ${monthLabel(month)}`}>
          <SimpleTable
            headers={["Name", "Present", "On leave", "Absent", "Days so far"]}
            empty="No staff this month"
            rows={summaries.map(({ userId, name, active, summary: s }) => [
              <TextLink key="n" href={`/admin/staff/${userId}`}>{active ? name : `${name} (inactive)`}</TextLink>,
              s.present,
              s.upcomingLeave ? `${s.leave} (${s.upcomingLeave} coming up)` : s.leave,
              s.absent ?? "—",
              s.daysSoFar,
            ])}
          />
          <p className="mt-2 text-xs text-muted-foreground">Absence runs from the day each person joined, or the day attendance started if that&apos;s later, up to today. Days someone was inactive aren&apos;t absent, future days aren&apos;t counted, and today isn&apos;t called absent until the day is over.</p>
        </Section>
      </div>
    </>
  );
}
