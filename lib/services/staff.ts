import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import { db, isUniqueViolation } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { dateToDayKey, dayKeyToDate, isDayKey, istMonthKey, monthRangeIST, toNumber } from "@/lib/format";
import { ATTENDANCE_ROLES, attendanceStart, recordActiveChange, staffStartKey } from "@/lib/services/attendance";
import { assertNoActiveJobs, assertRoleChange, moveNotificationLinks, passwordField, recheckActiveJobs, staffRoleField, userFieldSchemas, userSelect } from "@/lib/services/users";
import { ACTIVE_STATUSES } from "@/lib/status";

const MAX_SALARY = 9_999_999_999.99;

export const text = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

/** Forms send "" for blank. Stored as a string so no float reaches the Decimal column. */
export const salaryField = z.union([
  z.literal("").transform(() => null),
  z.null(),
  z.number().transform(String),
  z.string().trim(),
]).pipe(
  z.string()
    .regex(/^\d+(\.\d{1,2})?$/, "Salary must be a positive amount with at most 2 decimals")
    .refine((v) => Number(v) <= MAX_SALARY, "Salary is too large")
    .transform((v) => Number(v).toFixed(2))
    .nullable(),
);

export const joinedOnField = z.union([
  z.literal("").transform(() => null),
  z.null(),
  z.string().refine(isDayKey, "Enter a valid date"),
]);

/** Role can only be worker or receptionist here: this route can't promote anyone. */
export const staffProfileSchema = z.object({
  name: userFieldSchemas.name,
  email: userFieldSchemas.email,
  phone: userFieldSchemas.phone,
  role: staffRoleField,
  jobTitle: text(120),
  salary: salaryField,
  joinedOn: joinedOnField,
  address: text(500),
  emergencyContact: text(200),
  staffNotes: text(2000),
  active: z.boolean(),
  password: passwordField,
}).partial();

const ownSelect = {
  ...userSelect,
  jobTitle: true,
  salary: true,
  joinedOn: true,
  address: true,
  emergencyContact: true,
} as const;

type OwnRow = Prisma.UserGetPayload<{ select: typeof ownSelect }>;

const plain = ({ salary, joinedOn, ...u }: OwnRow, floor: string) => ({
  ...u,
  salary: salary?.toFixed(2) ?? null,
  joinedOn: joinedOn ? dateToDayKey(joinedOn) : null,
  startKey: staffStartKey({ joinedOn, createdAt: u.createdAt }, floor),
});

/** What someone may see about themselves: everything but staffNotes. */
export async function getOwnProfile(id: string) {
  const row = await db.user.findUnique({ where: { id }, select: ownSelect });
  return row && plain(row, await attendanceStart());
}

/** Admin only: includes staffNotes. Admin accounts have no staff profile. */
export async function getStaffProfile(id: string) {
  const row = await db.user.findFirst({
    where: { id, role: { in: ATTENDANCE_ROLES } },
    select: { ...ownSelect, staffNotes: true },
  });
  return row && { ...plain(row, await attendanceStart()), staffNotes: row.staffNotes };
}

export async function updateStaffProfile(actor: Actor, id: string, input: z.output<typeof staffProfileSchema>) {
  const before = await getStaffProfile(id);
  if (!before) throw notFound("STAFF_NOT_FOUND", "Staff member not found");
  if (input.role) await assertRoleChange(before, input.role);
  if (input.active === false && before.active) await assertNoActiveJobs(id);

  const { password, salary, joinedOn, ...rest } = input;
  const changed = (Object.keys(input) as (keyof typeof input)[]).filter((k) => k !== "password" && input[k] !== before[k]);
  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  try {
    await db.$transaction(async (tx) => {
      await recheckActiveJobs(tx, id, input);
      await tx.user.update({
        where: { id },
        data: {
          ...rest,
          ...(salary !== undefined ? { salary } : {}),
          ...(joinedOn !== undefined ? { joinedOn: joinedOn ? dayKeyToDate(joinedOn) : null } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      if (input.active !== undefined) await recordActiveChange(tx, id, input.active);
      if (input.role) await moveNotificationLinks(tx, id, before.role, input.role);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("DUPLICATE_EMAIL", "A user with this email already exists");
    throw err;
  }
  // Which fields changed, never their values: the log must not carry salary or notes.
  await logActivity(actor, {
    action: "STAFF_PROFILE_UPDATED",
    entityType: "User",
    entityId: id,
    summary: `${actor.name} updated ${before.name}'s staff profile${changed.includes("salary") ? " (salary changed)" : ""}${changed.includes("role") ? ` (now ${input.role === "WORKER" ? "a worker" : "a receptionist"})` : ""}`,
    metadata: { fields: changed, passwordChanged: Boolean(password) },
  });
  return (await getStaffProfile(id))!;
}

const recentJobSelect = { id: true, serviceNumber: true, serviceType: true, status: true, createdAt: true } as const;

export async function workerPerformance(userId: string, now = new Date()) {
  const { start, end } = monthRangeIST(istMonthKey(now));
  const [completed, activeJobs, paid, recentJobs] = await Promise.all([
    db.serviceJob.findMany({ where: { assignedWorkerId: userId, status: "COMPLETED" }, select: { createdAt: true, actualCompletion: true } }),
    db.serviceJob.count({ where: { assignedWorkerId: userId, status: { in: ACTIVE_STATUSES } } }),
    db.payment.findMany({ where: { status: "PAID", serviceJob: { assignedWorkerId: userId, status: "COMPLETED" } }, select: { amount: true } }),
    db.serviceJob.findMany({ where: { assignedWorkerId: userId }, orderBy: { createdAt: "desc" }, take: 8, select: recentJobSelect }),
  ]);
  const timed = completed.flatMap((j) => (j.actualCompletion ? [j.actualCompletion.getTime() - j.createdAt.getTime()] : []));
  return {
    completedThisMonth: completed.filter((j) => j.actualCompletion && j.actualCompletion >= start && j.actualCompletion < end).length,
    completedAllTime: completed.length,
    activeJobs,
    averageCompletionMs: timed.length ? timed.reduce((a, b) => a + b, 0) / timed.length : null,
    timedJobs: timed.length,
    revenue: paid.reduce((paise, p) => paise + Math.round(toNumber(p.amount) * 100), 0) / 100,
    recentJobs,
  };
}

export async function receptionPerformance(userId: string, now = new Date()) {
  const { start, end } = monthRangeIST(istMonthKey(now));
  const [createdThisMonth, createdAllTime, recentJobs] = await Promise.all([
    db.serviceJob.count({ where: { createdById: userId, createdAt: { gte: start, lt: end } } }),
    db.serviceJob.count({ where: { createdById: userId } }),
    db.serviceJob.findMany({ where: { createdById: userId }, orderBy: { createdAt: "desc" }, take: 8, select: recentJobSelect }),
  ]);
  return { createdThisMonth, createdAllTime, recentJobs };
}
