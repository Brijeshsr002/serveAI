# Sendiee integration

How to connect ServAI to Sendiee. Sendiee's [documentation](https://docs.sendiee.com/docs/introduction) is the source of truth for its API.

## 1. API key and brand number

Create a scoped key in the Sendiee dashboard under API & Webhooks, then set:

```env
SENDIEE_API_KEY=sk_...
SENDIEE_BRAND_NUMBER=917012345678   # digits only, no +
```

The key is used server-side only, from `lib/sendiee/client.ts`.

## 2. Required scopes

| Scope | Used for |
|---|---|
| `messages:send` | Sending templates and freeform messages |
| `messages:read` | Checking message status |
| `chats:read` | Conversation list and history (Sync from Sendiee) |
| `contacts:read`, `contacts:write` | Looking up and creating the contact before a sync |
| `conversations:read`, `conversations:write` | Teambox conversation status |
| `assignments:write` | Teambox assign and unassign |

## 3. WhatsApp templates

Automatic updates are sent as normal messages, so these are optional. WhatsApp can refuse a normal message when the customer hasn't messaged in 24 hours, and that send is marked failed. Templates were the old way to reach those customers, so without these, updates to quiet customers are not delivered. Create them in Sendiee and wait for Meta's approval. The names can be changed in **Settings**, but the parameter order must stay as shown.

| Template name | Body | Parameters |
|---|---|---|
| `serveai_service_update` | `Hi {{1}}, here's an update on your vehicle service {{2}}: {{3}}. Track it here: {{4}}` | name, service number, status, tracking link |
| `serveai_payment_request` | `Hi {{1}}, your final service amount is {{2}} for {{3}}. Pay securely here: {{4}}` | name, amount, service number, payment link |
| `serveai_payment_received` | `Hi {{1}}, we've received your payment of {{2}} for {{3}}. Thank you!` | name, amount, service number |
| `serveai_invoice` | `Hi {{1}}, your invoice {{2}} for {{3}} is ready: {{4}}` | name, invoice number, service number, link |

Use the **Utility** category. Sendiee answers an unapproved name with `TEMPLATE_NOT_FOUND`, which appears on the failed message in the inbox.

## 4. Webhooks

> **Sendiee has not published its webhook payload format or a signature scheme.** Its docs say "Detailed payload documentation for each event type is coming soon". ServAI therefore authenticates with a shared secret and parses leniently. Check your first real delivery as described in section 6.

Generate a secret and set it as `SENDIEE_WEBHOOK_SECRET`. Requests are refused if it's unset.

In the [Automation Builder](https://app.sendiee.com/dashboard/automations), add HTTP POST actions pointing to:

```
https://YOUR_DOMAIN/api/webhooks/sendiee
```

Send the secret as an `x-webhook-secret` header or `Authorization: Bearer` header. If the builder can't set headers, add `?secret=YOUR_SECRET` to the URL. A header is better, since URLs end up in logs.

| Trigger | Suggested body |
|---|---|
| New message received | `{ "event": "whatsapp.new_message", "data": { "phone": "...", "wamid": "...", "text": "...", "contactName": "..." } }` |
| Message status changed | `{ "event": "whatsapp.message_status", "data": { "messageId": "...", "status": "delivered" } }` |
| AI response generated, if you want AI replies in the inbox | `{ "event": "whatsapp.message_sent", "data": { "to": "...", "wamid": "...", "text": "..." } }` |
| Contact created | `{ "event": "contact.created", "data": { "phone": "...", "contactName": "..." } }` |

Use Sendiee's variables for the values. Other common field names are also accepted (`from`, `message`, `body`, `content.body`, `message.text.body`, `messageId`, `id`). See `lib/sendiee/normalizer.ts`.

Deliveries are safe to repeat: the same message ID is never stored twice.

## 5. AI assistant intake

Configure your Sendiee assistant with a function tool that POSTs collected details to:

```
POST https://YOUR_DOMAIN/api/webhooks/sendiee/service-request
x-webhook-secret: YOUR_SECRET
```

```json
{
  "phone": "919876543210",
  "name": "Brijesh",
  "brand": "Hyundai",
  "model": "Creta",
  "registrationNumber": "TN38AB1234",
  "serviceType": "General Service",
  "complaint": "Brake noise",
  "preferredDate": "2026-11-05",
  "preferredTime": "10:30",
  "externalRef": "unique-conversation-or-request-id"
}
```

ServAI creates or finds the customer and vehicle, creates a `NEW` job, and replies with the service ID. `complaint`, the preferred date and time, and `externalRef` are optional. Dates are read as IST.

Repeats return the existing job with `duplicate: true`. If the registration belongs to a different customer, the request gets `409 VEHICLE_OWNED_BY_OTHER_CUSTOMER` and is logged for staff, rather than attaching the job to the wrong person.

**Avoid double replies.** ServAI answers messages like "status", "how much?", "payment link" and "invoice". If your assistant also handles these, turn off **Auto-answer** in Settings, or have the assistant call ServAI's tracking data instead of answering itself.

## 6. Checking your first delivery

1. Send a WhatsApp message to your business number.
2. It should appear in the ServAI inbox.
3. If it doesn't, check `webhook_events` for rows with `outcome = 'unrecognized'`. The `payload` column holds exactly what Sendiee sent.
4. Add any new field names to `lib/sendiee/normalizer.ts`, and a case to `tests/whatsapp.test.ts`.

Only unrecognized payloads are kept in `payload`, and they may contain customer data, so clear them once you're done.

## Message sending

All messages go through `NotificationService` (`lib/notifications`). Each one is stored in `whatsapp_messages` first, then sent, then updated with the `wamid` or the error.

| Endpoint used | Purpose |
|---|---|
| `POST /v2.0/whatsapp/send` | Templates |
| `POST /v2.0/whatsapp/message` | Freeform, inside the 24-hour window |
| `GET /v2.0/whatsapp/message/status` | Delivery status |
| `POST /v2.0/contacts`, `POST /v2.0/contacts/phone` | Contacts |
| `GET /v2.0/chats/conversations`, `GET /v2.0/chats/history` | Inbox sync |
| `GET /v2.0/conversations/statuses`, `POST /v2.0/conversations/status` | Teambox status |
| `POST /v2.0/conversations/assign`, `POST /v2.0/conversations/unassign` | Teambox assignment |

Not implemented, because the endpoint wasn't confirmed from the docs: template listing (`lib/sendiee/templates.ts` holds the TODO).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `INSUFFICIENT_SCOPE` | Add the scope named in the error to your key |
| `TEMPLATE_NOT_FOUND` | Template isn't approved, or the name in Settings doesn't match |
| `WHATSAPP_WINDOW_CLOSED` | The customer hasn't messaged in 24 hours; freeform isn't allowed |
| `RATE_LIMIT_EXCEEDED_PER_DAY` | Your Sendiee plan's daily API limit was reached |
| `CONTACT_NOT_FOUND` on sync | Normally handled, since sync creates the contact first. Check `contacts:write` |
| `401` on the webhook | The secret doesn't match `SENDIEE_WEBHOOK_SECRET` |
| `503 WEBHOOK_NOT_CONFIGURED` | `SENDIEE_WEBHOOK_SECRET` is unset |
| Customer gets two replies | Both ServAI commands and the AI assistant are answering; see section 5 |
