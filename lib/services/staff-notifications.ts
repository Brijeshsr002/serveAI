import type { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { rupees } from "@/lib/format";

type Amount = Parameters<typeof rupees>[0];

export const markReadSchema = z.object({ ids: z.array(z.string().min(1)).max(100).optional() });

export const RATES_PAGE: Record<Role, string> = {
  ADMIN: "/admin/service-types",
  RECEPTIONIST: "/reception/service-rates",
  WORKER: "/worker/service-rates",
};

/** Goes to active staff only. A failure here is logged and swallowed: it must never block the rate change that caused it. */
async function notify(who: Prisma.UserWhereInput, title: string, body: string) {
  try {
    const users = await db.user.findMany({ where: { ...who, active: true }, select: { id: true, role: true } });
    if (users.length > 0) await db.staffNotification.createMany({ data: users.map((u) => ({ userId: u.id, title, body, link: RATES_PAGE[u.role] })) });
  } catch (err) {
    console.error("Staff notification failed:", (err as Error).message);
  }
}

export const notifyRateRequested = (item: string, rate: Amount, by: string) =>
  notify({ role: "ADMIN" }, "Rate change requested", `${by} asked to change ${item} to ${rupees(rate)}.`);

export const notifyRateChanged = (item: string, rate: Amount) =>
  notify({ role: { in: ["RECEPTIONIST", "WORKER"] } }, "Rate updated", `${item} is now ${rupees(rate)}.`);

/** Requests from before requesters were recorded only have a name to go on. */
export async function notifyRateRejected(requester: { id: string | null; name: string | null }, item: string, rate: Amount) {
  const who = requester.id ? { id: requester.id } : requester.name ? { name: requester.name } : null;
  if (who) await notify(who, "Rate request rejected", `Your request to change ${item} to ${rupees(rate)} was not approved.`);
}

/** Always scoped to the person asking: nobody can read another user's notifications. */
export async function myNotifications(userId: string) {
  const [items, unread] = await Promise.all([
    db.staffNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    }),
    db.staffNotification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export const markNotificationsRead = (userId: string, ids?: string[]) =>
  db.staffNotification.updateMany({ where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
