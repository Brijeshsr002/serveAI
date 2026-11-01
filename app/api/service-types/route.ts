import { authed, ok } from "@/lib/api/route";
import { db } from "@/lib/db";
import { ALL_ROLES, STAFF } from "@/lib/permissions";
import { addCatalogItem, catalogItemSchema } from "@/lib/services/service-rates";

// Services unless parts are asked for, so nothing listing job types can pick up a part by accident.
export const GET = authed(STAFF, async ({ req }) => {
  const kind = req.nextUrl.searchParams.get("kind");
  return db.serviceType.findMany({ where: kind === "ALL" ? {} : { kind: kind === "PART" ? "PART" : "SERVICE" }, orderBy: { name: "asc" } });
});

export const POST = authed(ALL_ROLES, async ({ user, actor, body }) => ok(await addCatalogItem(user, actor, await body(catalogItemSchema)), 201));
