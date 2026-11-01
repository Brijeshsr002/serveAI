import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { ADMIN_ONLY } from "@/lib/permissions";
import { getSettings, SETTING_KEYS } from "@/lib/settings";

const schema = z.partialRecord(z.enum(SETTING_KEYS), z.string().max(8000));

export const GET = authed(ADMIN_ONLY, async () => getSettings());

export const PATCH = authed(ADMIN_ONLY, async ({ actor, body }) => {
  const input = await body(schema);
  await db.$transaction(
    Object.entries(input).map(([key, value]) =>
      db.setting.upsert({ where: { key }, create: { key, value: value as string }, update: { value: value as string } }),
    ),
  );
  await logActivity(actor, { action: "SETTINGS_UPDATED", entityType: "Setting", summary: `${actor.name} updated settings`, metadata: { keys: Object.keys(input) } });
  return getSettings();
});
