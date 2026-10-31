import { brandNumber, sendieeRequest } from "./client";
import type { FreeformContent, FreeformType, SendResult, SendTemplateInput } from "./types";

type Envelope<T> = { success: boolean; data: T };

/** POST /v2.0/whatsapp/send. Required outside the 24-hour window. Scope: messages:send */
export async function sendTemplate(input: SendTemplateInput) {
  const res = await sendieeRequest<Envelope<SendResult>>("/v2.0/whatsapp/send", {
    method: "POST",
    body: { language: "en", ...input, brandNumber: brandNumber() },
  });
  return res.data;
}

/** POST /v2.0/whatsapp/message. Only inside the 24-hour window. Scope: messages:send */
export async function sendMessage(to: string, type: FreeformType, content: FreeformContent) {
  const res = await sendieeRequest<Envelope<SendResult>>("/v2.0/whatsapp/message", {
    method: "POST",
    body: { to, brandNumber: brandNumber(), type, content },
  });
  return res.data;
}

/** GET /v2.0/whatsapp/message/status. Scope: messages:read */
export async function getMessageStatus(messageId: string) {
  const res = await sendieeRequest<Envelope<{ messageId: string; status: string; recipient: string; timestamp: string }>>(
    "/v2.0/whatsapp/message/status",
    { query: { messageId, brandNumber: brandNumber() } },
  );
  return res.data;
}
