# ServAI

ServAI (code name `serveai`) is a WhatsApp-first CRM for car service centers. It tracks customers, vehicles, service jobs, workers, invoices and payments, and keeps customers updated on WhatsApp through [Sendiee](https://docs.sendiee.com).

```
Customer ⇄ WhatsApp ⇄ Sendiee ⇄ ServAI ⇄ Reception / Admin → Worker
                                  ↓
             Status updates · Invoice · Payment link · Tracking page
```

## Features

| Area | What it does |
|---|---|
| Roles | Admin, Receptionist and Worker, enforced on every API call |
| CRM | Customers (unique by phone), vehicles and service jobs. One Customers & Jobs page with a Jobs board tab and a Customers tab, and a search by name, phone or vehicle number at the top |
| Workflow | Enforced status transitions, full history, logged admin overrides |
| Worker view | Mobile-first; shows only the worker's own jobs |
| WhatsApp | Inbox, automatic status updates, customer commands, AI intake webhook. Admins edit the wording under Customer Messages, a button on the WhatsApp page |
| Billing | Service items, invoices with PDF, payment links, signed payment webhooks. One Billing page with Payments and Invoices tables on tabs (Payments only for reception), sending invoices and payment reminders on WhatsApp |
| Tracking | Public page per job, secured by a random token |
| Employees | One admin page for workers and receptionists, with People and Attendance tabs: role, salary, attendance, performance and a monthly CSV report |
| Admin | Dashboard with charts, report figures and CSV export, service types and rates, audit log, settings |

## Tech stack

Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui, PostgreSQL, Prisma 6, Zod, Recharts, PDFKit, jose (JWT), bcryptjs, Vitest, Docker.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: pages and API routes are thin, business rules live in `lib/services`, and all Sendiee traffic goes through `lib/notifications` → `lib/sendiee`. The browser only ever talks to ServAI.

## Development setup

Docker is not required. `npm run db:local` runs a real PostgreSQL from npm.

```bash
npm install
cp .env.example .env        # then set NEXTAUTH_SECRET (openssl rand -hex 32)
npm run db:local            # leave running, in its own terminal
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev                 # http://localhost:3000
```

Using your own PostgreSQL? Point `DATABASE_URL` at it and skip `db:local`.

### Development accounts

The seed creates these, all with password `ServeAI@123`, or `SEED_PASSWORD` if set. **The default is a public development credential. Never use it on a real deployment.** The seed refuses to run when `NODE_ENV=production`.

| Role | Email |
|---|---|
| Admin | `admin@serveai.local` |
| Receptionist | `reception@serveai.local` |
| Worker | `worker1@serveai.local`, `worker2@serveai.local` |

It also creates 10 customers, 15 vehicles, 20 jobs, sample invoices, payments and conversations. Seeded payments use a `seed` provider, so they have no real payment link.

### Tests

```bash
npm test          # starts its own throwaway PostgreSQL; no setup needed
npm run typecheck
```

Tests call the real route handlers against a real database. Only `fetch` to Sendiee and Razorpay is faked.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `NEXTAUTH_SECRET` | Yes | Signs session JWTs; 16+ characters |
| `APP_URL` | Yes | Public URL for tracking links. Use `https://` in production so cookies are marked Secure |
| `SENDIEE_API_KEY` | For WhatsApp | Scoped key, see [Sendiee setup](docs/SENDIEE_INTEGRATION.md) |
| `SENDIEE_BRAND_NUMBER` | For WhatsApp | Your WhatsApp number, digits only |
| `SENDIEE_WEBHOOK_SECRET` | For webhooks | Shared secret; webhooks are refused if unset |
| `DEFAULT_COUNTRY_CODE` | No | Added to 10-digit numbers. Default `91` |
| `PAYMENT_PROVIDER` | For payments | `razorpay` (default) or `stripe` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay | API and webhook credentials |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe | API and webhook credentials |
| `POSTGRES_PASSWORD` | docker-compose | Password for the bundled database |

The app runs without Sendiee or payment credentials. Messages are stored as failed, the Billing send buttons show `WHATSAPP_NOT_CONFIGURED`, and payment requests return `PAYMENT_NOT_CONFIGURED`.

## Sendiee setup

Follow [docs/SENDIEE_INTEGRATION.md](docs/SENDIEE_INTEGRATION.md). You need a scoped API key, four approved templates, and webhook automations.

## Payment setup

Razorpay:

1. Create API keys and set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. Add a webhook pointing to `https://YOUR_DOMAIN/api/webhooks/payment`, with events `payment_link.paid`, `payment_link.cancelled`, `payment_link.expired` and `refund.processed`.
3. Set the webhook's secret as `RAZORPAY_WEBHOOK_SECRET`.

Stripe: set `PAYMENT_PROVIDER=stripe` and subscribe the same URL to `checkout.session.completed`, `checkout.session.expired` and `charge.refunded`.

A payment becomes `PAID` only from a signature-verified webhook whose amount matches. To add a provider, implement `PaymentProvider` in `lib/payments/types.ts` and register it in `lib/payments/index.ts`.

## Docker setup

```bash
cp .env.example .env     # set NEXTAUTH_SECRET, APP_URL, POSTGRES_PASSWORD
docker compose up -d --build
docker compose exec app npm run admin:create -- "Your Name" you@example.com "a-strong-password"
```

The app runs migrations on start. Database files persist in the `postgres-data` volume.

## Production deployment

Without Docker:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run admin:create -- "Your Name" you@example.com "a-strong-password"
npm start
```

Before going live:

- [ ] Serve over HTTPS and set `APP_URL` to the `https://` address
- [ ] Use unique, generated values for all secrets
- [ ] Have your reverse proxy overwrite `X-Forwarded-For`, because rate limits and audit IPs rely on it
- [ ] Back up PostgreSQL
- [ ] Run a single app instance, or replace the in-memory limiter in `lib/rate-limit.ts` with Redis
- [ ] Send a real test message and a real test payment (see Known limitations)

## API documentation

See [docs/API.md](docs/API.md).

## Known limitations

- **Sendiee webhook format:** Sendiee has not published its payload format or a signature scheme. `lib/sendiee/normalizer.ts` accepts the likely shapes and stores anything unrecognized for inspection. Confirm it with a real delivery.
- **Not yet tested against live services:** Sendiee and Razorpay calls follow their docs but were tested against stand-ins. Stripe has unit-level signature tests only.
- **Teambox assignment** is available by API (`POST /api/whatsapp/conversations/:customerId/teambox`), but the inbox UI only offers sync.
- **Free-text intake:** a plain "I need a service" message is stored but doesn't create a job, because a job needs a registration number. The Sendiee AI assistant collects the details and posts them to the intake webhook.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `NEXTAUTH_SECRET must be set` | Add it to `.env` |
| Can't connect to database | Start `npm run db:local`, or check `DATABASE_URL` |
| `character ... has no equivalent in encoding "WIN1252"` | The database wasn't created as UTF-8. `db:local` now creates UTF-8; delete an older `.pgdata` folder |
| Login works but you're logged out at once | `APP_URL` is `https://` while you're browsing over plain HTTP, so the Secure cookie is dropped |
| Messages show `NOT_CONFIGURED` | Set `SENDIEE_API_KEY` and `SENDIEE_BRAND_NUMBER`, then restart |
| Messages show `TEMPLATE_NOT_FOUND` | The template name in Settings isn't approved in Sendiee |
| Inbox doesn't show new messages | Check the webhook setup, or use **Sync from Sendiee** on the conversation |
| Payment stays Pending after paying | Check the provider's webhook URL and secret, and its delivery log |
| `429` on login | Rate limit: wait 15 minutes or restart the app |
