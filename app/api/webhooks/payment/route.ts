import { open } from "@/lib/api/route";
import { db, isUniqueViolation } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { PaymentService, providerForWebhook } from "@/lib/payments";

export const POST = open(
  async ({ req }) => {
    const rawBody = await req.text();
    const provider = providerForWebhook(req.headers);
    if (!provider || !provider.verifyWebhook(rawBody, req.headers)) {
      throw new ApiError(401, "INVALID_SIGNATURE", "Invalid webhook signature");
    }
    const event = provider.parseWebhook(rawBody, req.headers);

    let record;
    try {
      record = await db.webhookEvent.create({
        data: { provider: provider.name, eventId: event.eventId, eventType: event.rawType },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return { outcome: "duplicate" };
      throw err;
    }
    try {
      const outcome = await PaymentService.applyEvent(provider, event);
      await db.webhookEvent.update({ where: { id: record.id }, data: { outcome } });
      return { outcome };
    } catch (err) {
      // Forget the delivery so the provider's retry is processed instead of treated as a duplicate.
      await db.webhookEvent.delete({ where: { id: record.id } });
      throw err;
    }
  },
  { limit: { name: "webhook-payment", limit: 600, windowMs: 60_000 } },
);
