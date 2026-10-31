import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { ApiError, badRequest, notFound } from "@/lib/errors";
import { STAFF } from "@/lib/permissions";
import { sendieeClient, SendieeError } from "@/lib/sendiee";

const schema = z.object({
  status: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1).optional(),
  teamId: z.string().trim().min(1).optional(),
  unassign: z.boolean().optional(),
});

// Conversation status and assignment live in Sendiee's Teambox; this proxies its documented API.
export const POST = authed(STAFF, async ({ actor, params, body }) => {
  const input = await body(schema);
  const customer = await db.customer.findUnique({ where: { id: params.customerId } });
  if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  const locator = { phone: customer.phone };
  try {
    if (input.status) {
      await sendieeClient.setConversationStatus(locator, input.status);
      await db.whatsappConversation.updateMany({ where: { customerId: customer.id }, data: { status: input.status } });
    } else if (input.unassign) {
      await sendieeClient.unassignConversation(locator);
    } else if (input.agentId || input.teamId) {
      await sendieeClient.assignConversation(locator, { agentId: input.agentId, teamId: input.teamId });
    } else {
      throw badRequest("NOTHING_TO_DO", "Provide status, agentId, teamId or unassign");
    }
  } catch (err) {
    if (err instanceof SendieeError) throw new ApiError(502, err.code, err.message);
    throw err;
  }
  await logActivity(actor, { action: "CONVERSATION_UPDATED", entityType: "Customer", entityId: customer.id, summary: `${actor.name} updated the Sendiee conversation for ${customer.name}`, metadata: input });
  return null;
});
