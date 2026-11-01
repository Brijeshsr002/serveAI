import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/api/route";
import { db, type DbClient } from "@/lib/db";

export const SYSTEM_ACTOR: Actor = { id: null, role: "SYSTEM", name: "ServAI" };

export async function logActivity(
  actor: Actor,
  entry: {
    action: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    metadata?: Prisma.InputJsonValue;
  },
  client: DbClient = db,
) {
  await client.activityLog.create({
    data: {
      userId: actor.id,
      actorRole: actor.role,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      metadata: entry.metadata,
      ip: actor.ip ?? null,
    },
  });
}
