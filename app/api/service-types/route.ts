import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { authed, ok } from "@/lib/api/route";
import { db, isUniqueViolation } from "@/lib/db";
import { conflict } from "@/lib/errors";
import { ADMIN_ONLY, STAFF } from "@/lib/permissions";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

export const GET = authed(STAFF, async () => db.serviceType.findMany({ orderBy: { name: "asc" } }));

export const POST = authed(ADMIN_ONLY, async ({ actor, body }) => {
  try {
    const type = await db.serviceType.create({ data: await body(schema) });
    await logActivity(actor, { action: "SERVICE_TYPE_CREATED", entityType: "ServiceType", entityId: type.id, summary: `${actor.name} added service type ${type.name}` });
    return ok(type, 201);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("DUPLICATE_SERVICE_TYPE", "This service type already exists");
    throw err;
  }
});
