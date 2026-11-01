import { z } from "zod";
import { open } from "@/lib/api/route";
import { db } from "@/lib/db";
import { conflict } from "@/lib/errors";
import { decideItems } from "@/lib/services/invoices";
import { itemRef, jobByToken } from "@/lib/services/tracking";

const schema = z.object({ ref: z.string().min(1).max(64), approve: z.boolean() });

export const POST = open(
  async ({ params, actor, body }) => {
    const job = await jobByToken(params.token);
    const { ref, approve } = await body(schema);
    const pending = await db.serviceItem.findMany({ where: { serviceJobId: job.id, approval: "PENDING" }, select: { id: true, name: true, total: true } });
    const match = pending.filter((i) => itemRef(i) === ref).map((i) => i.id);
    const decided = match.length > 0 ? await decideItems(actor, job.id, match, approve) : [];
    if (decided.length === 0) throw conflict("ITEM_ALREADY_ANSWERED", "This item changed or was already answered. Please check the page again.");
    return null;
  },
  { limit: { name: "track-approval", limit: 20, windowMs: 60_000 } },
);
