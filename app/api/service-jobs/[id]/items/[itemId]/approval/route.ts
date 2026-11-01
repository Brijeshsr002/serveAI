import { z } from "zod";
import { authed } from "@/lib/api/route";
import { conflict } from "@/lib/errors";
import { STAFF } from "@/lib/permissions";
import { decideItems } from "@/lib/services/invoices";

const schema = z.object({ approve: z.boolean() });

export const POST = authed(STAFF, async ({ actor, params, body }) => {
  const { approve } = await body(schema);
  const decided = await decideItems(actor, params.id, [params.itemId], approve);
  if (decided.length === 0) throw conflict("ITEM_ALREADY_ANSWERED", "This item was already answered");
  return null;
});
