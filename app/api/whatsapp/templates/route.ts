import { authed } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { STAFF } from "@/lib/permissions";
import { composerTemplates } from "@/lib/services/whatsapp-templates";

export const GET = authed(STAFF, async ({ req }) => {
  const customerId = req.nextUrl.searchParams.get("customerId");
  if (!customerId) throw badRequest("CUSTOMER_REQUIRED", "Choose a customer");
  return composerTemplates(customerId);
});
