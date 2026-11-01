import { logActivity, SYSTEM_ACTOR } from "@/lib/activity";
import { open, ok } from "@/lib/api/route";
import { rupees } from "@/lib/format";
import { trackingUrl } from "@/lib/settings";
import { intakeSchema, processServiceRequest, verifySendieeSecret } from "@/lib/services/whatsapp";

export const POST = open(
  async ({ req, body }) => {
    verifySendieeSecret(req);
    const { job, duplicate } = await processServiceRequest(await body(intakeSchema));
    if (!duplicate) {
      await logActivity(SYSTEM_ACTOR, { action: "WHATSAPP_INTAKE", entityType: "ServiceJob", entityId: job.id, summary: `WhatsApp created service request ${job.serviceNumber}` });
    }
    return ok(
      { serviceNumber: job.serviceNumber, duplicate, trackingUrl: trackingUrl(job.trackingToken), estimatedPrice: job.estimatedAmount ? rupees(job.estimatedAmount) : null },
      duplicate ? 200 : 201,
    );
  },
  { limit: { name: "webhook-intake", limit: 120, windowMs: 60_000 } },
);
