import { authed } from "@/lib/api/route";
import { ADMIN_ONLY } from "@/lib/permissions";
import { decideRate, rateDecisionSchema } from "@/lib/services/service-rates";

export const POST = authed(ADMIN_ONLY, async ({ actor, params, body }) => {
  const { approve } = await body(rateDecisionSchema);
  return decideRate(actor, params.id, approve);
});
