import bcrypt from "bcryptjs";
import { type Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import { db, type DbClient, isUniqueViolation, lockUserRow } from "@/lib/db";
import { ApiError, badRequest, conflict, notFound } from "@/lib/errors";
import { recordActiveChange } from "@/lib/services/attendance";
import { RATES_PAGE } from "@/lib/services/staff-notifications";
import { ACTIVE_STATUSES } from "@/lib/status";

export const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  active: true,
  createdAt: true,
} as const;

export const passwordField = z.string().min(8, "Password must be at least 8 characters").max(200);

export const userFieldSchemas = {
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(20).optional().nullable().transform((v) => v || null),
  role: z.enum(Role),
};

/** The roles the app can hand out. Admin accounts only come from scripts/create-admin.mjs. */
export const staffRoleField = z.enum(["WORKER", "RECEPTIONIST"]);

export const userSchema = z.object({ ...userFieldSchemas, role: staffRoleField, password: passwordField });
export const userPatchSchema = z.object({ ...userFieldSchemas, password: passwordField, active: z.boolean() }).partial();
export const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordField });

export async function createUser(actor: Actor, input: z.output<typeof userSchema>, staffFields: Pick<Prisma.UserUncheckedCreateInput, "jobTitle" | "salary" | "joinedOn"> = {}) {
  const { password: plain, ...data } = input;
  try {
    const user = await db.user.create({
      data: { ...data, ...staffFields, passwordHash: await bcrypt.hash(plain, 12) },
      select: userSelect,
    });
    await logActivity(actor, {
      action: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      summary: `${actor.name} created ${user.role.toLowerCase()} ${user.name}`,
    });
    return user;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("DUPLICATE_EMAIL", "A user with this email already exists");
    throw err;
  }
}

export async function assertNoActiveJobs(id: string, client: DbClient = db) {
  const active = await client.serviceJob.count({ where: { assignedWorkerId: id, status: { in: ACTIVE_STATUSES } } });
  if (active > 0) throw conflict("WORKER_HAS_ACTIVE_JOBS", `Reassign this worker's ${active} active job(s) first`);
}

/** Every role change goes through here, whichever route it came from. */
export async function assertRoleChange(target: { id: string; role: Role }, next: Role) {
  if (next === target.role) return;
  if (target.role === "ADMIN" || next === "ADMIN") throw badRequest("ROLE_NOT_ALLOWED", "Admin access can't be given or changed here");
  if (target.role === "WORKER") await assertNoActiveJobs(target.id);
}

/**
 * The active-jobs rule again, inside the transaction that makes the change. The check before it can be stale by then,
 * and more so with a password to hash in between. A job assigned in that gap rolls this change back.
 */
export async function recheckActiveJobs(tx: Prisma.TransactionClient, id: string, input: { role?: Role; active?: boolean }) {
  if (!input.role && input.active !== false) return;
  await lockUserRow(tx, id);
  const current = await tx.user.findUnique({ where: { id }, select: { role: true, active: true } });
  if (!current) return;
  const leavesWorkers = current.role === "WORKER" && input.role !== undefined && input.role !== "WORKER";
  if (leavesWorkers || (input.active === false && current.active)) await assertNoActiveJobs(id, tx);
}

/** Notifications they already have keep working: each one links to a page of the role it was sent to. */
export async function moveNotificationLinks(tx: Prisma.TransactionClient, userId: string, from: Role, to: Role) {
  if (from !== to) await tx.staffNotification.updateMany({ where: { userId, link: RATES_PAGE[from] }, data: { link: RATES_PAGE[to] } });
}

export async function updateUser(actor: Actor, id: string, input: z.output<typeof userPatchSchema>) {
  const { password: plain, ...data } = input;
  if (id === actor.id && (input.active === false || (input.role && input.role !== "ADMIN"))) {
    throw badRequest("CANNOT_CHANGE_SELF", "You can't deactivate or demote your own account");
  }
  const target = input.role ? await db.user.findUnique({ where: { id }, select: { id: true, role: true } }) : null;
  if (input.role && !target) throw notFound("USER_NOT_FOUND", "User not found");
  if (target && input.role) await assertRoleChange(target, input.role);
  if (input.active === false) await assertNoActiveJobs(id);
  const passwordHash = plain ? await bcrypt.hash(plain, 12) : null;
  try {
    const user = await db.$transaction(async (tx) => {
      await recheckActiveJobs(tx, id, input);
      const updated = await tx.user.update({
        where: { id },
        data: { ...data, ...(passwordHash ? { passwordHash } : {}) },
        select: userSelect,
      });
      if (input.active !== undefined) await recordActiveChange(tx, id, input.active);
      if (target) await moveNotificationLinks(tx, id, target.role, updated.role);
      return updated;
    });
    await logActivity(actor, {
      action: "USER_UPDATED",
      entityType: "User",
      entityId: id,
      summary: `${actor.name} updated user ${user.name}`,
      metadata: { fields: Object.keys(input).filter((k) => k !== "password"), passwordChanged: Boolean(plain) },
    });
    return user;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("DUPLICATE_EMAIL", "A user with this email already exists");
    throw err;
  }
}

/** "Delete" deactivates: audit logs and job history must keep pointing at a real person. */
export async function deactivateUser(actor: Actor, id: string) {
  if (id === actor.id) throw badRequest("CANNOT_CHANGE_SELF", "You can't delete your own account");
  const existing = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound("USER_NOT_FOUND", "User not found");
  const user = await db.$transaction(async (tx) => {
    await recheckActiveJobs(tx, id, { active: false });
    const updated = await tx.user.update({ where: { id }, data: { active: false }, select: userSelect });
    await recordActiveChange(tx, id, false);
    return updated;
  });
  await logActivity(actor, {
    action: "USER_DEACTIVATED",
    entityType: "User",
    entityId: id,
    summary: `${actor.name} deactivated ${user.name}`,
  });
  return user;
}

export async function changeOwnPassword(userId: string, actor: Actor, input: z.output<typeof passwordSchema>) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new ApiError(400, "WRONG_PASSWORD", "Your current password is incorrect");
  }
  await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(input.newPassword, 12) }, select: { id: true } });
  await logActivity(actor, { action: "PASSWORD_CHANGED", entityType: "User", entityId: userId, summary: `${actor.name} changed their password` });
}
