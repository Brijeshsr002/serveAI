import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import { db, isUniqueViolation } from "@/lib/db";
import { ApiError, badRequest, conflict, notFound } from "@/lib/errors";
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

const password = z.string().min(8, "Password must be at least 8 characters").max(200);

const fields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(20).optional().nullable().transform((v) => v || null),
  role: z.enum(Role),
};

export const userSchema = z.object({ ...fields, password });
export const userPatchSchema = z.object({ ...fields, password, active: z.boolean() }).partial();
export const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

export async function createUser(actor: Actor, input: z.output<typeof userSchema>) {
  const { password: plain, ...data } = input;
  try {
    const user = await db.user.create({
      data: { ...data, passwordHash: await bcrypt.hash(plain, 12) },
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

async function assertNoActiveJobs(id: string) {
  const active = await db.serviceJob.count({ where: { assignedWorkerId: id, status: { in: ACTIVE_STATUSES } } });
  if (active > 0) throw conflict("WORKER_HAS_ACTIVE_JOBS", `Reassign this worker's ${active} active job(s) first`);
}

export async function updateUser(actor: Actor, id: string, input: z.output<typeof userPatchSchema>) {
  const { password: plain, ...data } = input;
  if (id === actor.id && (input.active === false || (input.role && input.role !== "ADMIN"))) {
    throw badRequest("CANNOT_CHANGE_SELF", "You can't deactivate or demote your own account");
  }
  if (input.active === false) await assertNoActiveJobs(id);
  try {
    const user = await db.user.update({
      where: { id },
      data: { ...data, ...(plain ? { passwordHash: await bcrypt.hash(plain, 12) } : {}) },
      select: userSelect,
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
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) throw notFound("USER_NOT_FOUND", "User not found");
  await assertNoActiveJobs(id);
  const user = await db.user.update({ where: { id }, data: { active: false }, select: userSelect });
  await logActivity(actor, {
    action: "USER_DEACTIVATED",
    entityType: "User",
    entityId: id,
    summary: `${actor.name} deactivated ${user.name}`,
  });
  return user;
}

export async function changeOwnPassword(userId: string, actor: Actor, input: z.output<typeof passwordSchema>) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new ApiError(400, "WRONG_PASSWORD", "Your current password is incorrect");
  }
  await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(input.newPassword, 12) } });
  await logActivity(actor, { action: "PASSWORD_CHANGED", entityType: "User", entityId: userId, summary: `${actor.name} changed their password` });
}
