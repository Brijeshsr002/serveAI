import { authed } from "@/lib/api/route";
import { ALL_ROLES, STAFF } from "@/lib/permissions";
import { getJobForUser, jobPatchSchema, updateJob } from "@/lib/services/jobs";

export const GET = authed(ALL_ROLES, async ({ user, params }) => getJobForUser(user, params.id));

export const PATCH = authed(STAFF, async ({ actor, params, body }) =>
  updateJob(actor, params.id, await body(jobPatchSchema)),
);
