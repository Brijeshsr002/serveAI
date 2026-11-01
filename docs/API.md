# ServAI API

## Conventions

**Authentication.** `POST /api/auth/login` sets an httpOnly `serveai_session` cookie that lasts 12 hours. Authenticated routes need it. Cross-site writes are rejected.

**Success**

```json
{ "success": true, "data": {} }
```

**Error**

```json
{ "success": false, "error": { "code": "SERVICE_NOT_FOUND", "message": "Service job not found" } }
```

**Common errors**

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid body; the message names the field |
| 401 | `UNAUTHENTICATED` | Not logged in |
| 403 | `FORBIDDEN` | Your role can't do this |
| 404 | `NOT_FOUND` | Record not found |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected; details are in the server log only |

**Access** in the tables below: **All** = any logged-in user, **Staff** = Admin and Receptionist, **Admin** = Admin only, **Public** = no login.

Phone numbers are accepted in any common format and stored as digits with the country code (`919876543210`).

## Auth

| Method | URL | Access | Body | Errors |
|---|---|---|---|---|
| POST | `/api/auth/login` | Public | `email`, `password` | 401 `INVALID_CREDENTIALS`, 429 `RATE_LIMITED` |
| POST | `/api/auth/logout` | Public | none | |
| GET | `/api/auth/me` | All | none | 401 |

Example:

```bash
curl -c jar -X POST https://HOST/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@serveai.local","password":"..."}'
# {"success":true,"data":{"id":"…","name":"Admin","role":"ADMIN","redirectTo":"/admin/dashboard"}}
```

## Customers

| Method | URL | Access | Body or query | Errors |
|---|---|---|---|---|
| GET | `/api/customers` | Staff | `?q=` name, phone, code or registration | |
| POST | `/api/customers` | Staff | `name`*, `phone`*, `email`, `address`, `city`, `notes` | 400 `INVALID_PHONE`, 409 `DUPLICATE_PHONE` |
| GET | `/api/customers/:id` | Staff | | 404 `CUSTOMER_NOT_FOUND` |
| PATCH | `/api/customers/:id` | Staff | Any of the above | 409 `DUPLICATE_PHONE` |
| DELETE | `/api/customers/:id` | Admin | | 409 `CUSTOMER_HAS_HISTORY` |

\* required

Example:

```bash
curl -b jar -X POST https://HOST/api/customers -H 'Content-Type: application/json' \
  -d '{"name":"Asha","phone":"+91 98765 43210"}'
# 201 {"success":true,"data":{"id":"…","customerCode":"CUS-000001","phone":"919876543210",…}}
```

## Vehicles

| Method | URL | Access | Body or query | Errors |
|---|---|---|---|---|
| GET | `/api/vehicles` | Staff | `?q=`, `?customerId=` | |
| POST | `/api/vehicles` | Staff | `customerId`*, `registrationNumber`*, `brand`*, `model`*, `variant`, `manufacturingYear`, `fuelType`, `color`, `odometer` | 404 `CUSTOMER_NOT_FOUND`, 409 `DUPLICATE_REGISTRATION` |
| GET | `/api/vehicles/:id` | Staff | | 404 `VEHICLE_NOT_FOUND` |
| PATCH | `/api/vehicles/:id` | Staff | Any vehicle field except `customerId` | 409 `DUPLICATE_REGISTRATION` |

## Service jobs

Workers only see and change jobs assigned to them. Anything else returns 404.

| Method | URL | Access | Body or query | Errors |
|---|---|---|---|---|
| GET | `/api/service-jobs` | All | `?status=`, `?q=` | |
| POST | `/api/service-jobs` | Staff | `customerId`*, `vehicleId`*, `serviceType`*, `customerComplaint`, `internalNotes`, `estimatedAmount`, `priority`, `appointmentDate`, `expectedCompletion`, `assignedWorkerId` | 400 `VEHICLE_CUSTOMER_MISMATCH` |
| GET | `/api/service-jobs/:id` | All | | 404 `SERVICE_NOT_FOUND` |
| PATCH | `/api/service-jobs/:id` | Staff | Any of `serviceType`, `customerComplaint`, `internalNotes`, `estimatedAmount`, `priority`, `appointmentDate`, `expectedCompletion` | 404 |
| POST | `/api/service-jobs/:id/assign` | Staff | `workerId`* | 400 `INVALID_WORKER`, 409 `SERVICE_CLOSED`, 409 `ALREADY_ASSIGNED` |
| POST | `/api/service-jobs/:id/status` | All, by rule | `status`*, `notes`, `override` | see below |
| POST | `/api/service-jobs/:id/items` | Staff, assigned worker | `itemType`* (`PART`, `LABOUR`, `SERVICE`), `name`*, `unitPrice`*, `quantity`, `description`, `tax`, `discount`, `notifyCustomer`. Workers can't set tax or discount, and the customer is always told | 409 `SERVICE_ALREADY_PAID`, 409 `SERVICE_CLOSED`, 409 `PAYMENT_PENDING` |
| PATCH | `/api/service-jobs/:id/items/:itemId` | Staff, assigned worker | Same as POST | 404 `ITEM_NOT_FOUND`, same 409s as POST |
| DELETE | `/api/service-jobs/:id/items/:itemId` | Staff, assigned worker | `?notify=1` tells the customer when staff remove a line | 404 `ITEM_NOT_FOUND`, same 409s as POST |
| GET | `/api/workers` | Staff | Workers with `activeJobs` | |

`tax` and `discount` on items are rupee amounts, not percentages.

**Status errors:** 422 `INVALID_STATUS_TRANSITION`, 409 `STATUS_UNCHANGED`, 409 `STATUS_CONFLICT` (someone else just changed it), 400 `OVERRIDE_REASON_REQUIRED`, 403 `FORBIDDEN`. Rules are in [ARCHITECTURE.md](ARCHITECTURE.md#status-workflow).

Example:

```bash
curl -b jar -X POST https://HOST/api/service-jobs/JOB_ID/status -H 'Content-Type: application/json' \
  -d '{"status":"INSPECTION"}'
```

## Payments

| Method | URL | Access | Body | Errors |
|---|---|---|---|---|
| GET | `/api/payments` | Staff | | |
| POST | `/api/payments/create` | Staff | `serviceJobId`*, `notifyCustomer` (default true) | 409 `INVOICE_REQUIRED`, `SERVICE_ALREADY_PAID`, `SERVICE_CLOSED`, `NOTHING_TO_PAY`, `PAYMENT_IN_PROGRESS`; 503 `PAYMENT_NOT_CONFIGURED`; 502 `PAYMENT_PROVIDER_ERROR` |
| GET | `/api/payments/:id` | Staff | | 404 `PAYMENT_NOT_FOUND` |

There's no amount field: the amount is always the invoice total. Calling create again returns the open link (200), or cancels and replaces it if the bill changed (201).

## Invoices

| Method | URL | Access | Body | Errors |
|---|---|---|---|---|
| GET | `/api/invoices` | Admin | | |
| POST | `/api/invoices` | Staff | `serviceJobId`* (creates or rebuilds) | 409 `NO_SERVICE_ITEMS`, `SERVICE_ALREADY_PAID` |
| GET | `/api/invoices/:id` | Staff | | 404 `INVOICE_NOT_FOUND` |
| GET | `/api/invoices/:id/pdf` | Staff | Returns `application/pdf` | 404 |
| POST | `/api/invoices/:id/send` | Staff | Sends on WhatsApp | 404, 502 Sendiee errors |

## WhatsApp

| Method | URL | Access | Body | Errors |
|---|---|---|---|---|
| POST | `/api/whatsapp/send` | Staff | `customerId`*, plus `text` or `templateName` with `bodyParameters`; optional `serviceJobId` | 409 `WHATSAPP_WINDOW_CLOSED`, 502 Sendiee code |
| GET | `/api/whatsapp/conversations` | Staff | | |
| GET | `/api/whatsapp/conversations/:customerId` | Staff | Messages; marks it read | 404 |
| POST | `/api/whatsapp/conversations/:customerId/sync` | Staff | Imports Sendiee history; returns `imported` | 502 Sendiee code |
| POST | `/api/whatsapp/conversations/:customerId/teambox` | Staff | One of: `status`; `agentId` and/or `teamId`; `unassign: true` | 400 `NOTHING_TO_DO`, 502 Sendiee code |

## Webhooks

| Method | URL | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/webhooks/sendiee` | Shared secret | Incoming messages and statuses |
| POST | `/api/webhooks/sendiee/service-request` | Shared secret | Requests collected by the AI assistant |
| POST | `/api/webhooks/payment` | Provider signature | Payment results |

Sendiee webhook responses: `data.outcome` is `stored`, `duplicate`, `updated`, `stale`, `unrecognized` and similar. Errors are 401 `INVALID_WEBHOOK_SECRET` and 503 `WEBHOOK_NOT_CONFIGURED`. Payload details are in [SENDIEE_INTEGRATION.md](SENDIEE_INTEGRATION.md).

Payment webhook responses: `data.outcome` is `paid`, `already_paid`, `duplicate`, `amount_mismatch`, `unmatched`, `refunded`, `cancelled` or `ignored`. A bad signature returns 401 `INVALID_SIGNATURE`.

## Customer tracking

The token authorizes access, so no login is needed. Unknown tokens return 404 `TRACKING_NOT_FOUND`. Responses never include database IDs, internal notes or worker details.

| Method | URL | Access | Returns |
|---|---|---|---|
| GET | `/api/track/:token` | Token | Service summary, timeline and payment status |
| POST | `/api/track/:token/pay` | Token | `{ paymentLink }`, created from the invoice total |
| GET | `/api/track/:token/invoice` | Token | PDF, or 404 `INVOICE_NOT_FOUND` |

## Attendance

Days are IST calendar days and clock times come from the server. No record means absent for an active worker or receptionist, from the later of their joining day and the day attendance started, and not for days they were inactive. A real record always counts, including for inactive staff.

| Method | URL | Access | Body or query | Errors |
|---|---|---|---|---|
| POST | `/api/attendance/clock` | All | `action`*: `in` or `out`, for the logged-in user | 409 `ALREADY_CLOCKED_IN`, `ON_LEAVE`, `NOT_CLOCKED_IN`, `ALREADY_CLOCKED_OUT` |
| GET | `/api/attendance` | Admin | `?date=yyyy-mm-dd`, default today | 400 `INVALID_DATE` |
| POST | `/api/attendance/mark` | Admin | `userId`*, `date`*, `action`*: `leave`, `present` or `clear`, `note` | 400 `BEFORE_JOINING`, `FUTURE_DATE`, `TOO_FAR_AHEAD`; 404 `STAFF_NOT_FOUND`; 409 `ALREADY_CLOCKED_IN` |

## Administration

Salary and staff notes are only read and written through `/api/users/:id/profile`. Other user endpoints never return them.

| Method | URL | Access | Body or query | Errors |
|---|---|---|---|---|
| GET | `/api/users/:id/profile` | Admin | Worker or receptionist, with salary and notes | 404 `STAFF_NOT_FOUND` |
| PATCH | `/api/users/:id/profile` | Admin | Any of `name`, `email`, `phone`, `jobTitle`, `salary`, `joinedOn`, `address`, `emergencyContact`, `staffNotes`, `active`, `password` | 404 `STAFF_NOT_FOUND`, 409 `DUPLICATE_EMAIL`, `WORKER_HAS_ACTIVE_JOBS` |
| GET | `/api/users` | Admin | `?role=` | |
| POST | `/api/users` | Admin | `name`*, `email`*, `role`*, `password`*, `phone` | 409 `DUPLICATE_EMAIL` |
| PATCH | `/api/users/:id` | Admin | Any of those, plus `active` | 400 `CANNOT_CHANGE_SELF`, 409 `WORKER_HAS_ACTIVE_JOBS` |
| DELETE | `/api/users/:id` | Admin | Deactivates the user | 400 `CANNOT_CHANGE_SELF`, 409 `WORKER_HAS_ACTIVE_JOBS` |
| POST | `/api/profile/password` | All | `currentPassword`*, `newPassword`* | 400 `WRONG_PASSWORD` |
| GET, POST | `/api/service-types` | GET Staff, POST Admin | `name`*, `description` | 409 `DUPLICATE_SERVICE_TYPE` |
| PATCH | `/api/service-types/:id` | Admin | `name`, `description`, `active` | |
| GET, PATCH | `/api/settings` | Admin | Key-value pairs of known setting keys | |
| GET | `/api/search` | Staff | `?q=` returns `customers`, `vehicles`, `jobs`, `invoices` | |
| GET | `/api/reports/export` | Admin | `?type=services`, `payments` or `workers` returns CSV | 400 `UNKNOWN_REPORT` |
| GET | `/api/activity-logs` | Admin | Latest 200 | |
