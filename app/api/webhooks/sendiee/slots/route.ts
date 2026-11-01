import { open, ok } from "@/lib/api/route";
import { garageAvailability } from "@/lib/services/whatsapp-booking";
import { verifySendieeSecret } from "@/lib/services/whatsapp";

export const GET = open(
  async ({ req }) => {
    verifySendieeSecret(req);
    return ok(await garageAvailability());
  },
  { limit: { name: "webhook-slots", limit: 120, windowMs: 60_000 } },
);
