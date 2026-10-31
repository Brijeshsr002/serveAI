import { open } from "@/lib/api/route";
import { PaymentService } from "@/lib/payments";
import { jobByToken } from "@/lib/services/tracking";

export const POST = open(
  async ({ params, actor }) => {
    const job = await jobByToken(params.token);
    const { payment } = await PaymentService.getOrCreateForJob(actor, job.id);
    return { paymentLink: payment.paymentLink };
  },
  { limit: { name: "track-pay", limit: 20, windowMs: 60_000 } },
);
