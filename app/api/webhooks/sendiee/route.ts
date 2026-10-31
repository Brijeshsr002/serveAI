import { open } from "@/lib/api/route";
import { processSendieeWebhook, verifySendieeSecret } from "@/lib/services/whatsapp";

export const POST = open(
  async ({ req }) => {
    verifySendieeSecret(req);
    return processSendieeWebhook(await req.text());
  },
  { limit: { name: "webhook-sendiee", limit: 600, windowMs: 60_000 } },
);
