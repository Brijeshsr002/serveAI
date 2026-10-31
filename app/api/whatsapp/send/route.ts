import { authed, ok } from "@/lib/api/route";
import { STAFF } from "@/lib/permissions";
import { sendSchema, sendStaffMessage } from "@/lib/services/whatsapp";

export const POST = authed(STAFF, async ({ actor, body }) => ok(await sendStaffMessage(actor, await body(sendSchema)), 201));
