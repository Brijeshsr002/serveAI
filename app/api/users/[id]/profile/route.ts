import { authed } from "@/lib/api/route";
import { notFound } from "@/lib/errors";
import { ADMIN_ONLY } from "@/lib/permissions";
import { getStaffProfile, staffProfileSchema, updateStaffProfile } from "@/lib/services/staff";

export const GET = authed(ADMIN_ONLY, async ({ params }) => {
  const profile = await getStaffProfile(params.id);
  if (!profile) throw notFound("STAFF_NOT_FOUND", "Staff member not found");
  return profile;
});

export const PATCH = authed(ADMIN_ONLY, async ({ actor, params, body }) =>
  updateStaffProfile(actor, params.id, await body(staffProfileSchema)),
);
