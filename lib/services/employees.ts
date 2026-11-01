import type { Prisma, Role } from "@prisma/client";
import type { z } from "zod";
import type { Actor } from "@/lib/api/route";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { dateToDayKey, dayKeyToDate, isMonthKey, istDayKey, istMonthKey, monthRangeIST } from "@/lib/format";
import { ATTENDANCE_ROLES, attendanceStart, monthSummariesFor, staffStartKey } from "@/lib/services/attendance";
import { toCsv } from "@/lib/services/reports";
import { joinedOnField, salaryField, text } from "@/lib/services/staff";
import { createUser, userSchema, userSelect } from "@/lib/services/users";
import { ACTIVE_STATUSES } from "@/lib/status";

export const employeeRoleLabel = (role: Role) => (role === "WORKER" ? "Worker" : "Receptionist");

export const employeeCreateSchema = userSchema.extend({
  jobTitle: text(120),
  salary: salaryField.optional(),
  joinedOn: joinedOnField.optional(),
});

export function createEmployee(actor: Actor, input: z.output<typeof employeeCreateSchema>) {
  const { jobTitle, salary, joinedOn, ...user } = input;
  return createUser(actor, user, { jobTitle, salary, joinedOn: joinedOn ? dayKeyToDate(joinedOn) : null });
}

/** A month from the query string: blank means this month, anything unreadable is refused. */
export function monthParam(value: string | null | undefined) {
  if (!value) return istMonthKey(new Date());
  if (!isMonthKey(value)) throw badRequest("INVALID_MONTH", "Month must look like 2026-11");
  return value;
}

/** Phones are free text, so "98765 43210" and "+91 9876543210" are compared on their digits, on both sides. */
async function staffWithPhoneDigits(digits: string) {
  const staff = await db.user.findMany({ where: { role: { in: ATTENDANCE_ROLES }, phone: { not: null } }, select: { id: true, phone: true } });
  return staff.filter((s) => s.phone!.replace(/\D/g, "").includes(digits)).map((s) => s.id);
}

async function searchWhere(q: string | undefined): Promise<Prisma.UserWhereInput> {
  const term = q?.trim();
  if (!term) return {};
  const digits = term.replace(/\D/g, "");
  // Only a term that looks like a phone number: the digits in raj123@gmail.com aren't one.
  const byDigits = digits.length >= 3 && /^[\d\s+()-]+$/.test(term) ? await staffWithPhoneDigits(digits) : [];
  return {
    OR: [
      { name: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
      { id: { in: byDigits } },
    ],
  };
}

const countsBy = (rows: { id: string | null; count: number }[]) => new Map(rows.flatMap((r) => (r.id ? [[r.id, r.count] as const] : [])));

/** Admin only: carries salary. Staff notes stay out of it. Decimals and dates are strings, so a row can go to a client component. */
export async function listEmployees({ q, id, month, now = new Date() }: { q?: string; id?: string; month?: string; now?: Date } = {}) {
  const today = istDayKey(now);
  const key = month ?? istMonthKey(now);
  const { start, end } = monthRangeIST(key);
  const users = await db.user.findMany({
    where: { role: { in: ATTENDANCE_ROLES }, ...(id ? { id } : {}), ...(await searchWhere(q)) },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { ...userSelect, jobTitle: true, salary: true, joinedOn: true },
  });
  const ids = users.map((u) => u.id);
  const [summaries, floor, todayRows, active, completed, created] = await Promise.all([
    monthSummariesFor(users, key, today),
    attendanceStart(),
    db.attendance.findMany({ where: { date: dayKeyToDate(today), userId: { in: ids } }, select: { userId: true, status: true } }),
    db.serviceJob.groupBy({ by: ["assignedWorkerId"], where: { assignedWorkerId: { in: ids }, status: { in: ACTIVE_STATUSES } }, _count: true }),
    db.serviceJob.groupBy({ by: ["assignedWorkerId"], where: { assignedWorkerId: { in: ids }, status: "COMPLETED", actualCompletion: { gte: start, lt: end } }, _count: true }),
    db.serviceJob.groupBy({ by: ["createdById"], where: { createdById: { in: ids }, createdAt: { gte: start, lt: end } }, _count: true }),
  ]);
  const todayStatus = new Map(todayRows.map((r) => [r.userId, r.status]));
  const activeJobs = countsBy(active.map((r) => ({ id: r.assignedWorkerId, count: r._count })));
  const completedJobs = countsBy(completed.map((r) => ({ id: r.assignedWorkerId, count: r._count })));
  const createdJobs = countsBy(created.map((r) => ({ id: r.createdById, count: r._count })));
  return users.map(({ salary, joinedOn, createdAt, ...u }) => {
    const status = todayStatus.get(u.id);
    // Inactive people and people who haven't started yet aren't expected to clock in.
    const expected = u.active && staffStartKey({ joinedOn, createdAt }, floor) <= today;
    return {
      ...u,
      salary: salary?.toFixed(2) ?? null,
      joinedOn: joinedOn ? dateToDayKey(joinedOn) : null,
      today: status === "PRESENT" ? "Present" : status === "LEAVE" ? "On leave" : expected ? "Not clocked in" : "—",
      month: key,
      attendance: summaries.get(u.id)!,
      activeJobs: activeJobs.get(u.id) ?? 0,
      completedInMonth: completedJobs.get(u.id) ?? 0,
      createdInMonth: createdJobs.get(u.id) ?? 0,
    };
  });
}

export type Employee = Awaited<ReturnType<typeof listEmployees>>[number];

/** Every employee, whatever the page's search says. Jobs are counted for everyone, so someone who changed role mid-month keeps their figures. */
export async function employeeReportCsv(month: string, now = new Date()) {
  const employees = await listEmployees({ month, now });
  return toCsv(
    ["Name", "Role", "Status", "Job title", "Email", "Phone", "Joined on", "Monthly salary", "Month", "Days present", "Days on leave", "Days absent", "Active jobs now", "Jobs completed in month", "Jobs created in month"],
    employees.map((e) => [
      e.name, employeeRoleLabel(e.role), e.active ? "Active" : "Inactive", e.jobTitle, e.email, e.phone, e.joinedOn, e.salary, month,
      e.attendance.present, e.attendance.leave, e.attendance.absent, e.activeJobs, e.completedInMonth, e.createdInMonth,
    ]),
  );
}
