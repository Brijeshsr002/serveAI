import { open, ok } from "@/lib/api/route";
import { carStatus, carStatusSchema, verifySendieeSecret } from "@/lib/services/whatsapp";

export const POST = open(
  async ({ req, body }) => {
    verifySendieeSecret(req);
    return ok(await carStatus(await body(carStatusSchema)));
  },
  { limit: { name: "webhook-status", limit: 120, windowMs: 60_000 } },
);
