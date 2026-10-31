import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { ADMIN_ONLY } from "@/lib/permissions";

export const GET = authed(ADMIN_ONLY, async () =>
  db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: { name: true } } } }),
);
