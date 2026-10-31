import { authed } from "@/lib/api/route";
import { ALL_ROLES } from "@/lib/permissions";

export const GET = authed(ALL_ROLES, async ({ user }) => user);
