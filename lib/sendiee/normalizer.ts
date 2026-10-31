/**
 * TODO: pin this to Sendiee's real payload once published.
 *
 * The docs (https://docs.sendiee.com/docs/webhooks) name the events whatsapp.new_message,
 * whatsapp.message_sent, whatsapp.message_status and contact.created, and say a bsuid may sit
 * next to phone/from/to, but state "Detailed payload documentation ... is coming soon". The body
 * is also shaped per-automation in the Automation Builder. So this accepts the likely field
 * names, in one file, and anything it cannot read is stored on webhook_events for inspection.
 */
export type NormalizedEvent =
  | { kind: "message"; direction: "INBOUND" | "OUTBOUND"; phone: string | null; bsuid: string | null; name: string | null; messageId: string | null; text: string; messageType: string }
  | { kind: "status"; messageId: string; status: string }
  | { kind: "contact"; phone: string | null; bsuid: string | null; name: string | null }
  | { kind: "unknown"; event: string | null };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);
const first = (...values: unknown[]) => {
  for (const v of values) {
    const s = str(v);
    if (s) return s;
  }
  return null;
};

function messageText(d: Obj, message: Obj | null) {
  const nested = (v: unknown) => (isObj(v) ? first(v.body, v.text) : null);
  return first(
    d.text, nested(d.text),
    d.message, message && message.text, message && nested(message.text), message && message.body,
    d.body, d.content, nested(d.content),
  );
}

export function normalizeSendieeEvent(body: unknown): NormalizedEvent {
  if (!isObj(body)) return { kind: "unknown", event: null };
  const d = isObj(body.data) ? body.data : isObj(body.payload) ? body.payload : body;
  const event = first(body.event, body.type, body.eventType, d.event, d.eventType);
  const message = isObj(d.message) ? d.message : null;
  const contact = isObj(d.contact) ? d.contact : null;

  const messageId = first(d.wamid, d.messageId, d.message_id, message?.wamid, message?.id, d.id);
  const bsuid = first(d.bsuid, contact?.bsuid);
  const name = first(d.contactName, d.name, d.senderName, contact?.contactName, contact?.name);

  if (event === "whatsapp.message_status" || (event?.includes("status") && !event.includes("conversation"))) {
    const status = first(d.status, message?.status);
    return messageId && status ? { kind: "status", messageId, status } : { kind: "unknown", event };
  }

  if (event === "contact.created" || event === "contact.updated") {
    return { kind: "contact", phone: first(d.phone, contact?.phone), bsuid, name };
  }

  const outbound = event === "whatsapp.message_sent" || str(d.direction)?.toLowerCase() === "outbound";
  const inbound = event === "whatsapp.new_message" || !event || event.includes("message");
  if (outbound || inbound) {
    const phone = outbound
      ? first(d.to, d.recipient, d.phone, contact?.phone)
      : first(d.phone, d.from, d.sender, contact?.phone);
    const text = messageText(d, message);
    if ((phone || bsuid) && text) {
      return {
        kind: "message",
        direction: outbound ? "OUTBOUND" : "INBOUND",
        phone,
        bsuid,
        name,
        messageId,
        text,
        messageType: first(d.messageType, message?.type, d.type) ?? "text",
      };
    }
  }
  return { kind: "unknown", event };
}
