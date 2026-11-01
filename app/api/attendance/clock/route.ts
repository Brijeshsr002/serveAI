import { authed } from "@/lib/api/route";
import { ALL_ROLES } from "@/lib/permissions";
import { clockIn, clockOut, clockSchema } from "@/lib/services/attendance";

export const POST = authed(ALL_ROLES, async ({ user, body }) => {
  const { action } = await body(clockSchema);
  return action === "in" ? clockIn(user.id) : clockOut(user.id);
});
