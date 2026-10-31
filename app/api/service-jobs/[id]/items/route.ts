import { authed, ok } from "@/lib/api/route";
import { ALL_ROLES } from "@/lib/permissions";
import { addItem, itemSchema } from "@/lib/services/invoices";

export const POST = authed(ALL_ROLES, async ({ user, actor, params, body }) => ok(await addItem(user, actor, params.id, await body(itemSchema)), 201));
