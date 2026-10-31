import { authed } from "@/lib/api/route";
import { STAFF } from "@/lib/permissions";
import { removeItem } from "@/lib/services/invoices";

export const DELETE = authed(STAFF, async ({ actor, params }) => {
  await removeItem(actor, params.id, params.itemId);
  return null;
});
