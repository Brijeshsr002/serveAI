import { ServiceTypeKind } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import type { SessionUser } from "@/lib/auth/session";
import { db, isUniqueViolation } from "@/lib/db";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { toNumber } from "@/lib/format";
import { notifyRateChanged, notifyRateRejected, notifyRateRequested } from "@/lib/services/staff-notifications";
import { getSettings } from "@/lib/settings";
import { parsePriceList, UNCATALOGUED_WORK_NAMES } from "@/lib/work-catalog";

export const rateSchema = z.object({ rate: z.coerce.number().min(0).max(100_000_000) });
/** `proposedRate` is the amount the admin was looking at. A decision only ever applies to that amount. */
export const rateDecisionSchema = z.object({ approve: z.boolean(), proposedRate: z.coerce.number().min(0).max(100_000_000) });
export const catalogItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  kind: z.enum(ServiceTypeKind).default("SERVICE"),
  rate: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
    .pipe(z.number().min(0).max(100_000_000).nullable()),
});

/** Admins add services and parts. Anyone else can add a part, and its price waits for an admin like any other rate. */
export async function addCatalogItem(user: Pick<SessionUser, "role">, actor: Actor, input: z.output<typeof catalogItemSchema>) {
  const admin = user.role === "ADMIN";
  if (!admin && input.kind !== "PART") throw forbidden();
  if (!admin && input.rate === null) throw badRequest("RATE_REQUIRED", "Enter a price for the admin to approve");
  const { rate, ...fields } = input;
  try {
    const type = await db.serviceType.create({
      data: {
        ...fields,
        ...(admin ? { rate } : { proposedRate: rate, proposedBy: actor.name, proposedById: actor.id, proposedAt: new Date() }),
      },
    });
    const noun = type.kind === "PART" ? "part" : "service type";
    await logActivity(actor, { action: "SERVICE_TYPE_CREATED", entityType: "ServiceType", entityId: type.id, summary: `${actor.name} added ${noun} ${type.name}` });
    if (rate !== null) await (admin ? notifyRateChanged(type.name, rate) : notifyRateRequested(type.name, rate, actor.name));
    return type;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("DUPLICATE_SERVICE_TYPE", "A service or part with this name already exists");
    throw err;
  }
}

/** An admin's new rate applies at once. Anyone else's waits for an admin. */
export async function changeRate(user: Pick<SessionUser, "role">, actor: Actor, id: string, rate: number) {
  const type = await db.serviceType.findUnique({ where: { id } });
  if (!type) throw notFound("SERVICE_TYPE_NOT_FOUND", "Service type not found");
  const admin = user.role === "ADMIN";
  const saved = await db.serviceType.update({
    where: { id },
    data: admin
      ? { rate, proposedRate: null, proposedBy: null, proposedById: null, proposedAt: null }
      : { proposedRate: rate, proposedBy: actor.name, proposedById: actor.id, proposedAt: new Date() },
  });
  await logActivity(actor, {
    action: admin ? "SERVICE_RATE_UPDATED" : "SERVICE_RATE_PROPOSED",
    entityType: "ServiceType",
    entityId: id,
    summary: `${actor.name} ${admin ? "set" : "asked to change"} the ${type.name} rate to ₹${rate}`,
    metadata: { from: type.rate?.toString() ?? null, to: rate },
  });
  if (!admin) await notifyRateRequested(type.name, rate, actor.name);
  else if (type.rate === null || toNumber(type.rate) !== rate) await notifyRateChanged(type.name, rate);
  return saved;
}

export async function decideRate(actor: Actor, id: string, approve: boolean, seen: number) {
  const type = await db.serviceType.findUnique({ where: { id } });
  if (!type) throw notFound("SERVICE_TYPE_NOT_FOUND", "Service type not found");
  if (type.proposedRate === null) throw conflict("NO_RATE_REQUEST", "There's no rate change waiting on this item");
  // Matching on the amount means a request changed after the page loaded is never decided unseen, even mid-click.
  const { count } = await db.serviceType.updateMany({
    where: { id, proposedRate: seen },
    data: { ...(approve ? { rate: seen } : {}), proposedRate: null, proposedBy: null, proposedById: null, proposedAt: null },
  });
  if (count === 0) throw conflict("RATE_REQUEST_CHANGED", `The ${type.name} request has changed. Check the new amount and decide again.`);
  await logActivity(actor, {
    action: approve ? "SERVICE_RATE_APPROVED" : "SERVICE_RATE_REJECTED",
    entityType: "ServiceType",
    entityId: id,
    summary: `${actor.name} ${approve ? "approved" : "rejected"} ${type.proposedBy ?? "a"} change of the ${type.name} rate to ₹${seen}`,
  });
  if (!approve) await notifyRateRejected({ id: type.proposedById, name: type.proposedBy }, type.name, seen);
  else if (type.rate === null || toNumber(type.rate) !== seen) await notifyRateChanged(type.name, seen);
  return db.serviceType.findUniqueOrThrow({ where: { id } });
}

/** The default price for a service, if it has one. Never includes changes still waiting for approval, or a part's price. */
export async function defaultRate(serviceType: string) {
  const type = await db.serviceType.findFirst({ where: { name: serviceType, kind: "SERVICE" }, select: { rate: true } });
  return type?.rate ?? null;
}

/** What customers are quoted on WhatsApp. Parts stay out: they only mean something on a bill. */
export async function ratedServices() {
  const types = await db.serviceType.findMany({ where: { active: true, kind: "SERVICE", rate: { not: null } }, orderBy: { name: "asc" }, select: { name: true, rate: true } });
  return types.map((t) => ({ name: t.name, rate: toNumber(t.rate) }));
}

/** Name to amount for the bill forms: approved service and part rates, with the price list as the fallback. A hidden item has no price at all. */
export async function billPrices() {
  const prices = parsePriceList((await getSettings()).price_list);
  const rows = await db.serviceType.findMany({ select: { name: true, rate: true, active: true } });
  for (const { name, rate, active } of rows) {
    if (!active) delete prices[name];
    else if (rate !== null) prices[name] = toNumber(rate);
  }
  return prices;
}

/** Parts offered on the bill forms. Every built-in part has a row, so hiding or renaming one here is what the form shows. */
export const activePartNames = async () =>
  (await db.serviceType.findMany({ where: { active: true, kind: "PART" }, orderBy: { name: "asc" }, select: { name: true } })).map((t) => t.name);

/** Services offered on the bill forms: the catalog's, plus ready-made names with no row of their own. */
export async function activeServiceNames() {
  const rows = await db.serviceType.findMany({ where: { kind: "SERVICE" }, orderBy: { name: "asc" }, select: { name: true, active: true } });
  const known = new Set(rows.map((t) => t.name));
  return [...rows.filter((t) => t.active).map((t) => t.name), ...UNCATALOGUED_WORK_NAMES.filter((n) => !known.has(n))];
}

/** Everything a bill form needs to offer items and prefill their prices. */
export async function billCatalog() {
  const [prices, parts, services] = await Promise.all([billPrices(), activePartNames(), activeServiceNames()]);
  return { prices, parts, services };
}
