import { authed } from "@/lib/api/route";
import { ADMIN_ONLY } from "@/lib/permissions";
import { deactivateUser, updateUser, userPatchSchema } from "@/lib/services/users";

export const PATCH = authed(ADMIN_ONLY, async ({ actor, params, body }) =>
  updateUser(actor, params.id, await body(userPatchSchema)),
);

export const DELETE = authed(ADMIN_ONLY, async ({ actor, params }) => deactivateUser(actor, params.id));
