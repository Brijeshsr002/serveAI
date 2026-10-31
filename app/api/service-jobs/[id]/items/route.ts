import { authed, ok } from "@/lib/api/route";
import { STAFF } from "@/lib/permissions";
import { addItem, itemSchema } from "@/lib/services/invoices";

export const POST = authed(STAFF, async ({ actor, params, body }) => ok(await addItem(actor, params.id, await body(itemSchema)), 201));
