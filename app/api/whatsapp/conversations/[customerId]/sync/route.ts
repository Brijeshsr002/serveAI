import { authed } from "@/lib/api/route";
import { STAFF } from "@/lib/permissions";
import { syncConversation } from "@/lib/services/whatsapp";

export const POST = authed(STAFF, async ({ params }) => syncConversation(params.customerId));
