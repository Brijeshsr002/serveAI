import { authed } from "@/lib/api/route";
import { STAFF } from "@/lib/permissions";
import { syncInbox } from "@/lib/services/whatsapp";

export const POST = authed(STAFF, async ({ req }) => syncInbox(req.nextUrl.searchParams.get("c")));
