import { authed } from "@/lib/api/route";
import { ALL_ROLES } from "@/lib/permissions";
import { changeStatus, statusSchema } from "@/lib/services/jobs";

export const POST = authed(ALL_ROLES, async ({ user, actor, params, body }) =>
  changeStatus(user, actor, params.id, await body(statusSchema)),
);
