import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { toNumber } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { parsePriceList } from "@/lib/work-catalog";

export const rateSchema = z.object({ rate: z.coerce.number().min(0).max(100_000_000) });
export const rateDecisionSchema = z.object({ approve: z.boolean() });

/** An admin's new rate applies at once. Anyone else's waits for an admin. */
export async function changeRate(user: Pick<SessionUser, "role">, actor: Actor, id: string, rate: number) {
  const type = await db.serviceType.findUnique({ where: { id } });
  if (!type) throw notFound("SERVICE_TYPE_NOT_FOUND", "Service type not found");
  const admin = user.role === "ADMIN";
  const saved = await db.serviceType.update({
    where: { id },
    data: admin
      ? { rate, proposedRate: null, proposedBy: null, proposedAt: null }
      : { proposedRate: rate, proposedBy: actor.name, proposedAt: new Date() },
  });
  await logActivity(actor, {
    action: admin ? "SERVICE_RATE_UPDATED" : "SERVICE_RATE_PROPOSED",
    entityType: "ServiceType",
    entityId: id,
    summary: `${actor.name} ${admin ? "set" : "asked to change"} the ${type.name} rate to ₹${rate}`,
    metadata: { from: type.rate?.toString() ?? null, to: rate },
  });
  return saved;
}

export async function decideRate(actor: Actor, id: string, approve: boolean) {
  const type = await db.serviceType.findUnique({ where: { id } });
  if (!type) throw notFound("SERVICE_TYPE_NOT_FOUND", "Service type not found");
  if (type.proposedRate === null) throw conflict("NO_RATE_REQUEST", "There's no rate change waiting on this service");
  const saved = await db.serviceType.update({
    where: { id },
    data: { ...(approve ? { rate: type.proposedRate } : {}), proposedRate: null, proposedBy: null, proposedAt: null },
  });
  await logActivity(actor, {
    action: approve ? "SERVICE_RATE_APPROVED" : "SERVICE_RATE_REJECTED",
    entityType: "ServiceType",
    entityId: id,
    summary: `${actor.name} ${approve ? "approved" : "rejected"} ${type.proposedBy ?? "a"} change of the ${type.name} rate to ₹${toNumber(type.proposedRate)}`,
  });
  return saved;
}

/** The default price for a service, if it has one. Never includes changes still waiting for approval. */
export async function defaultRate(serviceType: string) {
  const type = await db.serviceType.findUnique({ where: { name: serviceType }, select: { rate: true } });
  return type?.rate ?? null;
}

export async function ratedServices() {
  const types = await db.serviceType.findMany({ where: { active: true, rate: { not: null } }, orderBy: { name: "asc" }, select: { name: true, rate: true } });
  return types.map((t) => ({ name: t.name, rate: toNumber(t.rate) }));
}

/** Name to amount for the bill forms: the price list, with approved service rates on top. */
export async function billPrices() {
  const prices = parsePriceList((await getSettings()).price_list);
  for (const { name, rate } of await ratedServices()) prices[name] = rate;
  return prices;
}
