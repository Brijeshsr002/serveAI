import { authed } from "@/lib/api/route";
import { STAFF } from "@/lib/permissions";
import { assignSchema, assignWorker } from "@/lib/services/jobs";

export const POST = authed(STAFF, async ({ actor, params, body }) => {
  const { workerId } = await body(assignSchema);
  return assignWorker(actor, params.id, workerId);
});
