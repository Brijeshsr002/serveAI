import { authed } from "@/lib/api/route";
import { ALL_ROLES } from "@/lib/permissions";
import { changeStatus, hideFromWorker, statusSchema } from "@/lib/services/jobs";

export const POST = authed(ALL_ROLES, async ({ user, actor, params, body }) => {
  const job = await changeStatus(user, actor, params.id, await body(statusSchema));
  return user.role === "WORKER" ? hideFromWorker(job) : job;
});
