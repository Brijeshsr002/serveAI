import { authed } from "@/lib/api/route";
import { ADMIN_ONLY } from "@/lib/permissions";
import { markSchema, setAttendance } from "@/lib/services/attendance";

export const POST = authed(ADMIN_ONLY, async ({ actor, body }) => setAttendance(actor, await body(markSchema)));
