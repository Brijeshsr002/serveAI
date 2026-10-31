import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { STAFF } from "@/lib/permissions";

// Opening a conversation marks it read.
export const GET = authed(STAFF, async ({ params }) => {
  const customer = await db.customer.findUnique({ where: { id: params.customerId }, include: { vehicles: true } });
  if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  const messages = await db.whatsappMessage.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  await db.whatsappConversation.updateMany({ where: { customerId: customer.id }, data: { unreadCount: 0 } });
  return { customer, messages };
});
