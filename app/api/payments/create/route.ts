import { z } from "zod";
import { authed, ok } from "@/lib/api/route";
import { STAFF } from "@/lib/permissions";
import { PaymentService } from "@/lib/payments";

// Deliberately has no amount field: the amount is always the server-side invoice total.
const schema = z.object({ serviceJobId: z.string().min(1), notifyCustomer: z.boolean().optional() });

export const POST = authed(STAFF, async ({ actor, body }) => {
  const { serviceJobId, notifyCustomer } = await body(schema);
  const { payment, created, notification, warning } = await PaymentService.getOrCreateForJob(actor, serviceJobId, { notifyCustomer: notifyCustomer ?? true });
  return ok({ ...payment, notification, warning }, created ? 201 : 200);
});
