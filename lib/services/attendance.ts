import type { AttendanceStatus, Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import { db, isUniqueViolation } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { redistributeLeave } from "@/lib/services/jobs";
import { addDayKey, dateToDayKey, dayKeyToDate, isDayKey, istDayKey, istMonthKey, lastDayOfMonth, time } from "@/lib/format";

export const ATTENDANCE_ROLES: Role[] = ["WORKER", "RECEPTIONIST"];
const MAX_LEAVE_AHEAD_DAYS = 366;

export type DayStatus = AttendanceStatus | "ABSENT" | "NONE";

export const todayKey = () => istDayKey(new Date());

const joinKey = (u: { joinedOn: Date | null; createdAt: Date }) => (u.joinedOn ? dateToDayKey(u.joinedOn) : istDayKey(u.createdAt));

/** The first day someone can count as absent: pass attendanceStart() as the floor. */
export const staffStartKey = (u: { joinedOn: Date | null; createdAt: Date }, floor = "") => {
  const joined = joinKey(u);
  return joined > floor ? joined : floor;
};

/** The day attendance went live, stamped by its migration. Nobody could clock in before it. Not an editable setting. */
export const attendanceStart = async () => (await db.setting.findUnique({ where: { key: "attendance_start" } }))?.value ?? "";

export type InactivePeriod = { from: string; until: string | null };

const wasInactive = (periods: InactivePeriod[], key: string) => periods.some((p) => key >= p.from && (!p.until || key < p.until));

const toPeriod = (p: { fromDate: Date; untilDate: Date | null }): InactivePeriod => ({ from: dateToDayKey(p.fromDate), until: p.untilDate && dateToDayKey(p.untilDate) });

const inactivePeriods = async (userId: string) => (await db.staffInactivePeriod.findMany({ where: { userId } })).map(toPeriod);

const overlapping = (from: Date, to: Date) => ({ fromDate: { lte: to }, OR: [{ untilDate: null }, { untilDate: { gt: from } }] });

/** Call in the same transaction as any change to User.active. Repeating a change is harmless. */
export async function recordActiveChange(tx: Prisma.TransactionClient, userId: string, active: boolean) {
  const today = dayKeyToDate(todayKey());
  if (active) await tx.staffInactivePeriod.updateMany({ where: { userId, untilDate: null }, data: { untilDate: today } });
  else await tx.staffInactivePeriod.createMany({ data: [{ userId, fromDate: today }], skipDuplicates: true });
}

export const dayKeySchema = z.string().refine(isDayKey, "Enter a valid date as yyyy-mm-dd");
export const clockSchema = z.object({ action: z.enum(["in", "out"]) });
export const markSchema = z.object({
  userId: z.string().min(1),
  date: dayKeySchema,
  action: z.enum(["leave", "present", "clear"]),
  note: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
});

// Staff see their own clock state; admin notes stay out of it.
const clockSelect = { date: true, status: true, clockInAt: true, clockOutAt: true } as const;

export const todayState = (userId: string) =>
  db.attendance.findUnique({ where: { userId_date: { userId, date: dayKeyToDate(todayKey()) } }, select: clockSelect });

const alreadyIn = () => conflict("ALREADY_CLOCKED_IN", "You're already clocked in for today");

export async function clockIn(userId: string) {
  const date = dayKeyToDate(todayKey());
  const existing = await db.attendance.findUnique({ where: { userId_date: { userId, date } } });
  if (existing?.status === "LEAVE") throw conflict("ON_LEAVE", "You're on leave today. Ask an admin to change it before clocking in.");
  if (existing?.clockInAt) throw alreadyIn();
  if (existing) {
    // Marked present by an admin with no time yet: this is the real arrival.
    const { count } = await db.attendance.updateMany({ where: { id: existing.id, status: "PRESENT", clockInAt: null }, data: { clockInAt: new Date() } });
    if (count === 0) throw alreadyIn();
    return db.attendance.findUniqueOrThrow({ where: { id: existing.id }, select: clockSelect });
  }
  try {
    return await db.attendance.create({ data: { userId, date, status: "PRESENT", clockInAt: new Date() }, select: clockSelect });
  } catch (err) {
    if (isUniqueViolation(err)) throw alreadyIn();
    throw err;
  }
}

export async function clockOut(userId: string) {
  const date = dayKeyToDate(todayKey());
  const existing = await db.attendance.findUnique({ where: { userId_date: { userId, date } } });
  if (!existing?.clockInAt) throw conflict("NOT_CLOCKED_IN", "You haven't clocked in today");
  const alreadyOut = () => conflict("ALREADY_CLOCKED_OUT", "You've already clocked out for today");
  if (existing.clockOutAt) throw alreadyOut();
  const { count } = await db.attendance.updateMany({ where: { id: existing.id, clockOutAt: null }, data: { clockOutAt: new Date() } });
  if (count === 0) throw alreadyOut();
  return db.attendance.findUniqueOrThrow({ where: { id: existing.id }, select: clockSelect });
}

type RowTimes = { clockInAt: Date | null; clockOutAt: Date | null };

export function dayLabel(status: DayStatus, row: RowTimes | null, isToday: boolean) {
  if (status === "LEAVE") return "On leave";
  if (status === "ABSENT") return isToday ? "Not clocked in" : "Absent";
  if (status === "NONE") return "—";
  if (!row?.clockInAt) return "Marked present";
  return row.clockOutAt ? `In ${time(row.clockInAt)} · Out ${time(row.clockOutAt)}` : `In at ${time(row.clockInAt)}`;
}

export async function teamDay(date = todayKey()) {
  const today = todayKey();
  const day = dayKeyToDate(date);
  const [staff, rows, floor, inactive] = await Promise.all([
    db.user.findMany({
      // Inactive staff are only listed for a day they have a real record.
      where: { role: { in: ATTENDANCE_ROLES }, OR: [{ active: true }, { attendance: { some: { date: day } } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, active: true, jobTitle: true, joinedOn: true, createdAt: true },
    }),
    db.attendance.findMany({ where: { date: day } }),
    attendanceStart(),
    db.staffInactivePeriod.findMany({ where: overlapping(day, day), select: { userId: true } }),
  ]);
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  const away = new Set(inactive.map((p) => p.userId));
  const entries = staff.flatMap((u) => {
    const row = byUser.get(u.id) ?? null;
    // Before someone joined, or while they were inactive, there is nothing to report for them.
    if (!row && (date < staffStartKey(u, floor) || away.has(u.id))) return [];
    const status: DayStatus = row?.status ?? (date > today ? "NONE" : "ABSENT");
    return [{
      userId: u.id,
      name: u.name,
      role: u.role,
      active: u.active,
      jobTitle: u.jobTitle,
      status,
      label: dayLabel(status, row, date === today),
      clockInAt: row?.clockInAt ?? null,
      clockOutAt: row?.clockOutAt ?? null,
      note: row?.note ?? null,
    }];
  });
  const count = (s: DayStatus) => entries.filter((e) => e.status === s).length;
  return { date, isToday: date === today, entries, present: count("PRESENT"), leave: count("LEAVE"), absent: count("ABSENT") };
}

export type TeamDay = Awaited<ReturnType<typeof teamDay>>;

export type MonthSummary = {
  month: string;
  present: number;
  leave: number;
  /** Null for inactive staff: absence is only derived for active people. */
  absent: number | null;
  /** Days up to and including today that have a record or could have been absent. */
  daysSoFar: number;
  /** Today has no record yet, so it isn't called absent until the day is over. */
  todayPending: boolean;
  upcomingLeave: number;
};

export function summarizeMonth(
  month: string,
  person: { startKey: string; active: boolean; inactive?: InactivePeriod[] },
  rows: { date: Date; status: AttendanceStatus }[],
  today = todayKey(),
): MonthSummary {
  const monthEnd = lastDayOfMonth(month);
  const first = `${month}-01` > person.startKey ? `${month}-01` : person.startKey;
  const last = monthEnd < today ? monthEnd : today;
  const keyed = rows.map((r) => ({ key: dateToDayKey(r.date), status: r.status })).filter((r) => r.key.startsWith(month));
  // A real record always counts. The start day and inactive spells only limit which empty days can be absent.
  const counted = keyed.filter((r) => r.key <= last);
  const present = counted.filter((r) => r.status === "PRESENT").length;
  const leave = counted.filter((r) => r.status === "LEAVE").length;
  const upcomingLeave = keyed.filter((r) => r.key > today && r.status === "LEAVE").length;
  const recorded = new Set(counted.map((r) => r.key));
  let empty = 0;
  for (let key = first; key <= last; key = addDayKey(key, 1)) {
    if (!recorded.has(key) && !wasInactive(person.inactive ?? [], key)) empty++;
  }
  const todayPending = person.active && first <= today && last === today && !recorded.has(today);
  const absent = person.active ? empty - (todayPending ? 1 : 0) : null;
  return { month, present, leave, absent, daysSoFar: counted.length + empty, todayPending, upcomingLeave };
}

const monthWhere = (month: string) => ({ gte: dayKeyToDate(`${month}-01`), lte: dayKeyToDate(lastDayOfMonth(month)) });

export async function personMonthSummary(person: { id: string; startKey: string; active: boolean }, month = istMonthKey(new Date())) {
  const [rows, inactive] = await Promise.all([
    db.attendance.findMany({ where: { userId: person.id, date: monthWhere(month) }, select: { date: true, status: true } }),
    inactivePeriods(person.id),
  ]);
  return summarizeMonth(month, { ...person, inactive }, rows);
}

export async function teamMonthSummaries(month = istMonthKey(new Date())) {
  const dates = monthWhere(month);
  const [staff, rows, floor, inactive] = await Promise.all([
    db.user.findMany({
      // Inactive staff are only listed for a month they have real records in.
      where: { role: { in: ATTENDANCE_ROLES }, OR: [{ active: true }, { attendance: { some: { date: dates } } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, active: true, joinedOn: true, createdAt: true },
    }),
    db.attendance.findMany({ where: { date: dates }, select: { userId: true, date: true, status: true } }),
    attendanceStart(),
    db.staffInactivePeriod.findMany({ where: overlapping(dates.gte, dates.lte) }),
  ]);
  return staff.map((u) => ({
    userId: u.id,
    name: u.name,
    active: u.active,
    summary: summarizeMonth(
      month,
      { startKey: staffStartKey(u, floor), active: u.active, inactive: inactive.filter((p) => p.userId === u.id).map(toPeriod) },
      rows.filter((r) => r.userId === u.id),
    ),
  }));
}

/** Newest first. Days without a record are only filled in as absent for active staff. */
export async function recentDays(person: { id: string; startKey: string; active: boolean }, count = 10) {
  const today = todayKey();
  const [rows, inactive] = await Promise.all([
    db.attendance.findMany({
      where: { userId: person.id, date: { gte: dayKeyToDate(addDayKey(today, 1 - count)), lte: dayKeyToDate(today) } },
    }),
    inactivePeriods(person.id),
  ]);
  const byDay = new Map(rows.map((r) => [dateToDayKey(r.date), r]));
  const days = [];
  for (let i = 0; i < count; i++) {
    const key = addDayKey(today, -i);
    const row = byDay.get(key) ?? null;
    if (!row && (key < person.startKey || !person.active || wasInactive(inactive, key))) continue;
    const status: DayStatus = row?.status ?? "ABSENT";
    days.push({ date: key, status, label: dayLabel(status, row, key === today), note: row?.note ?? null });
  }
  return days;
}

/** Admin: set one staff member's day. A recorded clock-in is never overwritten by leave; clearing is explicit. */
export async function setAttendance(actor: Actor, input: z.output<typeof markSchema>) {
  const { userId, date, action, note } = input;
  const person = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, joinedOn: true, createdAt: true } });
  if (!person || !ATTENDANCE_ROLES.includes(person.role)) throw notFound("STAFF_NOT_FOUND", "Staff member not found");
  const day = dayKeyToDate(date);
  const where = { userId_date: { userId, date: day } };
  const today = todayKey();

  if (action === "clear") {
    const existing = await db.attendance.findUnique({ where });
    if (!existing) return null;
    await db.attendance.delete({ where: { id: existing.id } });
    await logActivity(actor, {
      action: "ATTENDANCE_CLEARED",
      entityType: "User",
      entityId: userId,
      summary: `${actor.name} cleared ${person.name}'s attendance for ${date}`,
      metadata: {
        date,
        previousStatus: existing.status,
        clockInAt: existing.clockInAt?.toISOString() ?? null,
        clockOutAt: existing.clockOutAt?.toISOString() ?? null,
      },
    });
    return null;
  }

  if (date < joinKey(person)) throw badRequest("BEFORE_JOINING", `${person.name} hadn't joined by ${date}. Update their joined date first.`);
  if (action === "present" && date > today) throw badRequest("FUTURE_DATE", "You can't mark someone present on a future date");
  if (date > addDayKey(today, MAX_LEAVE_AHEAD_DAYS)) throw badRequest("TOO_FAR_AHEAD", "Leave can be set up to one year ahead");

  const select = { ...clockSelect, note: true } as const;
  let row;
  if (action === "present") {
    row = await db.attendance.upsert({
      where,
      create: { userId, date: day, status: "PRESENT", note, markedById: actor.id },
      update: { status: "PRESENT", note, markedById: actor.id },
      select,
    });
  } else {
    const clockedIn = () => conflict("ALREADY_CLOCKED_IN", `${person.name} has clocked in on ${date}. Clear the day first to mark leave.`);
    const existing = await db.attendance.findUnique({ where });
    if (existing?.clockInAt) throw clockedIn();
    if (existing) {
      const { count } = await db.attendance.updateMany({ where: { id: existing.id, clockInAt: null }, data: { status: "LEAVE", note, markedById: actor.id } });
      if (count === 0) throw clockedIn();
      row = await db.attendance.findUniqueOrThrow({ where: { id: existing.id }, select });
    } else {
      try {
        row = await db.attendance.create({ data: { userId, date: day, status: "LEAVE", note, markedById: actor.id }, select });
      } catch (err) {
        if (isUniqueViolation(err)) throw clockedIn();
        throw err;
      }
    }
  }
  await logActivity(actor, {
    action: "ATTENDANCE_MARKED",
    entityType: "User",
    entityId: userId,
    summary: `${actor.name} marked ${person.name} ${action === "leave" ? "on leave" : "present"} for ${date}`,
    metadata: { date, status: row.status, hasNote: Boolean(note) },
  });
  // Only today's leave moves work. The leave is already saved, so a failure here can't undo it.
  if (action === "leave" && date === today && person.role === "WORKER") {
    await redistributeLeave(person).catch((err) => console.error("Leave redistribution failed:", (err as Error).message));
  }
  return row;
}
