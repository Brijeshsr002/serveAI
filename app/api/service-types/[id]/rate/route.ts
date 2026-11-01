import { authed } from "@/lib/api/route";
import { ALL_ROLES } from "@/lib/permissions";
import { changeRate, rateSchema } from "@/lib/services/service-rates";

export const POST = authed(ALL_ROLES, async ({ user, actor, params, body }) => {
  const { rate } = await body(rateSchema);
  return changeRate(user, actor, params.id, rate);
});
