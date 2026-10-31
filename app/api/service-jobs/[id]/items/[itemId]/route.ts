import { authed } from "@/lib/api/route";
import { ALL_ROLES } from "@/lib/permissions";
import { itemSchema, removeItem, updateItem } from "@/lib/services/invoices";

export const PATCH = authed(ALL_ROLES, async ({ user, actor, params, body }) => updateItem(user, actor, params.id, params.itemId, await body(itemSchema)));

export const DELETE = authed(ALL_ROLES, async ({ req, user, actor, params }) => {
  await removeItem(user, actor, params.id, params.itemId, req.nextUrl.searchParams.get("notify") === "1");
  return null;
});
