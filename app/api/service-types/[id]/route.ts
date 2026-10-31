import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { ADMIN_ONLY } from "@/lib/permissions";

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
});

export const PATCH = authed(ADMIN_ONLY, async ({ actor, params, body }) => {
  const type = await db.serviceType.update({ where: { id: params.id }, data: await body(schema) });
  await logActivity(actor, { action: "SERVICE_TYPE_UPDATED", entityType: "ServiceType", entityId: type.id, summary: `${actor.name} updated service type ${type.name}` });
  return type;
});
