import { authed } from "@/lib/api/route";
import { ALL_ROLES, STAFF } from "@/lib/permissions";
import { getJobForUser, hideFromWorker, jobPatchSchema, updateJob } from "@/lib/services/jobs";

export const GET = authed(ALL_ROLES, async ({ user, params }) => {
  const job = await getJobForUser(user, params.id);
  return user.role === "WORKER" ? hideFromWorker(job) : job;
});

export const PATCH = authed(STAFF, async ({ actor, params, body }) =>
  updateJob(actor, params.id, await body(jobPatchSchema)),
);
