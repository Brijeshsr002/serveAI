import { authed } from "@/lib/api/route";
import { ALL_ROLES } from "@/lib/permissions";
import { changeOwnPassword, passwordSchema } from "@/lib/services/users";

export const POST = authed(ALL_ROLES, async ({ user, actor, body }) => {
  await changeOwnPassword(user.id, actor, await body(passwordSchema));
  return null;
});
