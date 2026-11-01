# Architecture

## Layers

```
Browser
  │  fetch /api/*  (session cookie). Never holds a Sendiee or payment secret.
  ▼
app/api/**  and  app/**/page.tsx      thin: auth, validation, rendering
  ▼
lib/services/*                        business rules: jobs, invoices, WhatsApp, reports
  ├─ lib/notifications  →  lib/sendiee   →  Sendiee API  →  WhatsApp
  ├─ lib/payments       →  razorpay | stripe
  └─ lib/db (Prisma)    →  PostgreSQL
```

## Key decisions

| Decision | Why |
|---|---|
| Every API route goes through `authed(roles, …)` or `open(…)` in `lib/api/route.ts` | One place for auth, CSRF origin check, rate limits and structured errors |
| The user is reloaded from the database on each request | Deactivating someone takes effect immediately, not at JWT expiry |
| Workers get 404, not 403, for other workers' jobs | They shouldn't learn that a job exists. `jobScope()` filters all worker reads |
| Status changes use `UPDATE … WHERE status = old` | Simultaneous clicks produce one change and one notification |
| Automatic notifications never throw | A WhatsApp outage must not undo a status change or payment. Failures are recorded on `notifications` |
| Sendiee POSTs never retry; GETs do | A retried send could reach the customer twice |
| Phone numbers are normalized on the way in | `+91 98765-43210` and `9876543210` must be one customer. The unique index settles races |
| Money is calculated in paise | Avoids floating-point errors on invoices |
| Payment amount always comes from the invoice | No endpoint accepts an amount from a client |
| Partial unique index `payments_one_open_per_job` | A double click cannot produce two payable links. It's raw SQL because Prisma can't model partial indexes |
| The tracking view is built field by field | New columns can't leak by accident. Internal notes, IDs and worker details are never included |
| "Deleting" a user deactivates them | Audit logs and history must keep pointing at a real person |

## Idempotency

| Source | Mechanism |
|---|---|
| Sendiee message | `whatsapp_messages.sendiee_message_id` unique. With no ID, a hash of the body is used |
| Sendiee status | Applied only if it moves forward (delivered can't overwrite read) |
| AI intake | `service_jobs.external_ref` unique, plus one open job per vehicle |
| Payment webhook | `webhook_events (provider, event_id)` unique. The row is removed if processing fails, so a retry still works |
| Payment confirmation | The update to `PAID` affects one row once, and only that caller sends the message |

## Status workflow

```
NEW → ASSIGNED → VEHICLE_RECEIVED → INSPECTION → SERVICE_IN_PROGRESS ⇄ WAITING_FOR_PARTS
                                                         ↓
                                     READY_FOR_DELIVERY → COMPLETED
```

| Role | May do |
|---|---|
| Assign action | NEW → ASSIGNED only happens by assigning a worker |
| Worker | Next forward step on their own jobs |
| Receptionist | Assign, reassign and cancel. The brief gives them no other status changes |
| Admin | Forward steps, cancel, and override to any status with a required reason, logged as `STATUS_OVERRIDE` |

Cancelling isn't in the brief's transition list. It's allowed for staff from any open status, because the status otherwise has no way to be reached.

Reaching READY_FOR_DELIVERY or COMPLETED generates the invoice automatically if the job has items. A job with no items is left without an invoice.

## WhatsApp messages

Updates always go as freeform text, using the editable messages in Settings. No templates are used. WhatsApp can refuse freeform text when the customer hasn't messaged in 24 hours; the send is then recorded as `FAILED` with Sendiee's error code.
