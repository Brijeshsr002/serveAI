import { authed } from "@/lib/api/route";
import { ALL_ROLES } from "@/lib/permissions";
import { myNotifications } from "@/lib/services/staff-notifications";

export const GET = authed(ALL_ROLES, async ({ user }) => myNotifications(user.id));
