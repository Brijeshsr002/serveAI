import { authed } from "@/lib/api/route";
import { ALL_ROLES } from "@/lib/permissions";
import { markNotificationsRead, markReadSchema, myNotifications } from "@/lib/services/staff-notifications";

export const POST = authed(ALL_ROLES, async ({ user, body }) => {
  const { ids } = await body(markReadSchema);
  await markNotificationsRead(user.id, ids);
  return myNotifications(user.id);
});
