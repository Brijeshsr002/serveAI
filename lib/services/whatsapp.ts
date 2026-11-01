import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { logActivity, SYSTEM_ACTOR } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import { db, isUniqueViolation, nextVehicleCode } from "@/lib/db";
import { ApiError, conflict, notFound } from "@/lib/errors";
import { isWindowOpen, loadJobContext, mapSendieeStatus, NotificationService, sendFreeformText, sendTemplateText } from "@/lib/notifications";
import { normalizePhone, normalizeRegistration } from "@/lib/phone";
import { sendieeClient, SendieeError } from "@/lib/sendiee";
import { normalizeSendieeEvent } from "@/lib/sendiee/normalizer";
import { findOrCreateCustomerByPhone } from "@/lib/services/customers";
import { createJob } from "@/lib/services/jobs";
import { runCommands } from "@/lib/services/whatsapp-commands";
import { ACTIVE_STATUSES } from "@/lib/status";

/** Accepts the shared secret from a header or query, since Automation Builder setups vary. */
export function verifySendieeSecret(req: { headers: { get(n: string): string | null }; nextUrl: URL }) {
  const expected = process.env.SENDIEE_WEBHOOK_SECRET;
  if (!expected) throw new ApiError(503, "WEBHOOK_NOT_CONFIGURED", "SENDIEE_WEBHOOK_SECRET is not set");
  const given =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.nextUrl.searchParams.get("secret") ??
    "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) throw new ApiError(401, "INVALID_WEBHOOK_SECRET", "Invalid webhook secret");
}

const ORDER = ["QUEUED", "ACCEPTED", "SENT", "DELIVERED", "READ"];

async function applyStatus(messageId: string, status: string) {
  const mapped = mapSendieeStatus(status);
  if (!mapped) return "unknown_status";
  const message = await db.whatsappMessage.findUnique({ where: { sendieeMessageId: messageId } });
  if (!message) return "message_not_found";
  // Webhooks can arrive out of order; "delivered" after "read" must not move it backwards.
  if (mapped !== "FAILED" && ORDER.indexOf(mapped) <= ORDER.indexOf(message.status)) return "stale";
  await db.whatsappMessage.update({ where: { id: message.id }, data: { status: mapped } });
  return "updated";
}

async function resolveCustomer(phone: string | null, bsuid: string | null, name: string | null) {
  const normalized = phone ? normalizePhone(phone) : null;
  if (normalized) return findOrCreateCustomerByPhone(normalized, name, bsuid);
  return bsuid ? db.customer.findUnique({ where: { bsuid } }) : null;
}

/** Entry point for POST /api/webhooks/sendiee. Safe to call repeatedly with the same delivery. */
export async function processSendieeWebhook(rawBody: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Body is not valid JSON");
  }
  const event = normalizeSendieeEvent(parsed);
  const eventHash = createHash("sha256").update(rawBody).digest("hex");

  if (event.kind === "unknown") {
    await db.webhookEvent
      .create({
        data: {
          provider: "sendiee",
          eventId: eventHash,
          eventType: event.event,
          outcome: "unrecognized",
          payload: parsed as Prisma.InputJsonValue,
        },
      })
      .catch((err) => {
        if (!isUniqueViolation(err)) throw err;
      });
    return { outcome: "unrecognized" };
  }

  if (event.kind === "status") return { outcome: await applyStatus(event.messageId, event.status) };

  if (event.kind === "contact") {
    const customer = await resolveCustomer(event.phone, event.bsuid, event.name);
    return { outcome: customer ? "contact_saved" : "contact_ignored" };
  }

  const customer = await resolveCustomer(event.phone, event.bsuid, event.name);
  if (!customer) return { outcome: "no_customer_identifier" };

  const activeJob = await db.serviceJob.findFirst({
    where: { customerId: customer.id, status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();

  // Without a provider id, the hash of the delivery stands in, so a redelivery still dedupes.
  const sendieeMessageId = event.messageId ?? `hash:${eventHash}`;
  try {
    await db.whatsappMessage.create({
      data: {
        customerId: customer.id,
        serviceJobId: activeJob?.id ?? null,
        direction: event.direction,
        messageType: event.messageType,
        content: event.text,
        sendieeMessageId,
        status: event.direction === "INBOUND" ? "RECEIVED" : "SENT",
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { outcome: "duplicate" };
    throw err;
  }

  await db.whatsappConversation.upsert({
    where: { customerId: customer.id },
    create: {
      customerId: customer.id,
      lastMessage: event.text,
      lastMessageAt: now,
      lastInboundAt: event.direction === "INBOUND" ? now : null,
      unreadCount: event.direction === "INBOUND" ? 1 : 0,
    },
    update: {
      lastMessage: event.text,
      lastMessageAt: now,
      ...(event.direction === "INBOUND" ? { lastInboundAt: now, unreadCount: { increment: 1 } } : {}),
    },
  });

  if (event.direction === "INBOUND") await runCommands(customer, event.text);
  return { outcome: "stored", customerId: customer.id };
}

/** Service request collected by the Sendiee AI assistant, posted to the intake webhook. */
export const intakeSchema = z.object({
  phone: z.string().min(5),
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  registrationNumber: z.string().trim().min(4).max(20),
  serviceType: z.string().trim().min(1).max(120),
  complaint: z.string().trim().max(5000).optional(),
  preferredDate: z.string().trim().optional(),
  preferredTime: z.string().trim().optional(),
  externalRef: z.string().trim().max(200).optional(),
});

function parseAppointment(date?: string, time?: string) {
  if (!date) return null;
  const clock = /^\d{1,2}:\d{2}$/.test(time ?? "") ? time!.padStart(5, "0") : "09:00";
  const parsed = new Date(`${date}T${clock}:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function processServiceRequest(input: z.output<typeof intakeSchema>) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ApiError(400, "INVALID_PHONE", "Enter a valid phone number");
  const registrationNumber = normalizeRegistration(input.registrationNumber);

  if (input.externalRef) {
    const existing = await db.serviceJob.findUnique({ where: { externalRef: input.externalRef } });
    if (existing) return { job: existing, duplicate: true };
  }

  const customer = await findOrCreateCustomerByPhone(phone, input.name);
  const { vehicleId } = await findOrCreateVehicle(customer.id, registrationNumber, input);

  const open = await db.serviceJob.findFirst({ where: { vehicleId, status: { in: ACTIVE_STATUSES } } });
  if (open) return { job: open, duplicate: true };

  const appointmentDate = parseAppointment(input.preferredDate, input.preferredTime);
  const unparsedPreference =
    !appointmentDate && (input.preferredDate || input.preferredTime)
      ? `Customer's preferred time: ${[input.preferredDate, input.preferredTime].filter(Boolean).join(" ")}`
      : null;

  const job = await createJob(
    { ...SYSTEM_ACTOR, name: "WhatsApp" },
    {
      customerId: customer.id,
      vehicleId,
      serviceType: input.serviceType,
      customerComplaint: input.complaint ?? null,
      internalNotes: unparsedPreference,
      appointmentDate,
      estimatedAmount: null,
      expectedCompletion: null,
    },
    input.externalRef,
    // Sent from inside createJob so "request received" goes before any auto-assignment message.
    true,
  );
  return { job, duplicate: false };
}

async function findOrCreateVehicle(
  customerId: string,
  registrationNumber: string,
  input: { brand: string; model: string },
) {
  const existing = await db.vehicle.findUnique({ where: { registrationNumber } });
  if (existing) {
    if (existing.customerId !== customerId) {
      await logActivity(SYSTEM_ACTOR, {
        action: "VEHICLE_OWNER_CONFLICT",
        entityType: "Vehicle",
        entityId: existing.id,
        summary: `WhatsApp request for ${registrationNumber} came from a different customer than its owner; needs review`,
      });
      throw conflict("VEHICLE_OWNED_BY_OTHER_CUSTOMER", "This vehicle is registered to another customer");
    }
    return { vehicleId: existing.id };
  }
  try {
    const vehicle = await db.vehicle.create({
      data: {
        customerId,
        registrationNumber,
        brand: input.brand,
        model: input.model,
        vehicleCode: await nextVehicleCode(),
      },
    });
    return { vehicleId: vehicle.id };
  } catch (err) {
    if (isUniqueViolation(err)) return findOrCreateVehicle(customerId, registrationNumber, input);
    throw err;
  }
}

export const sendSchema = z
  .object({
    customerId: z.string().min(1),
    serviceJobId: z.string().optional().nullable(),
    text: z.string().trim().min(1).max(4096).optional(),
    templateName: z.string().trim().min(1).optional(),
    bodyParameters: z.array(z.string()).optional(),
  })
  .refine((v) => v.text || v.templateName, "Provide text or templateName");

/** Staff-initiated send. Unlike automatic notifications, failures are reported to the caller. */
export async function sendStaffMessage(actor: Actor, input: z.output<typeof sendSchema>) {
  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  const spec = { customerId: customer.id, phone: customer.phone, serviceJobId: input.serviceJobId };

  if (!input.templateName && !(await isWindowOpen(customer.id))) {
    throw conflict(
      "WHATSAPP_WINDOW_CLOSED",
      "This customer hasn't messaged in the last 24 hours, so WhatsApp only allows an approved template",
    );
  }
  try {
    const message = input.templateName
      ? await sendTemplateText(
          { ...spec, text: input.text ?? `[template: ${input.templateName}]` },
          input.templateName,
          input.bodyParameters ?? [],
        )
      : await sendFreeformText({ ...spec, text: input.text! });
    await logActivity(actor, {
      action: "WHATSAPP_SENT",
      entityType: "Customer",
      entityId: customer.id,
      summary: `${actor.name} sent a WhatsApp message to ${customer.name}`,
    });
    return message;
  } catch (err) {
    if (err instanceof SendieeError) {
      throw new ApiError(502, err.code, err.code === "NOT_CONFIGURED" ? "WhatsApp is not configured yet" : err.message);
    }
    throw err;
  }
}

/**
 * Backfills from GET /v2.0/chats/history, the documented read API. This keeps the inbox
 * correct even if a webhook was missed, and also refreshes the 24-hour window.
 */
export async function syncConversation(customerId: string) {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  try {
    await sendieeClient.upsertContact({ phone: customer.phone, contactName: customer.name });
    const history = await sendieeClient.getChatHistory(customer.phone, { limit: 100 });
    const rows = history.data
      .filter((m) => !m.internal)
      .map((m) => ({
        customerId,
        direction: m.direction === "inbound" ? ("INBOUND" as const) : ("OUTBOUND" as const),
        messageType: m.type,
        content: m.text ?? `[${m.type}]`,
        sendieeMessageId: m.wamid ?? m.messageId,
        status: mapSendieeStatus(m.status) ?? (m.direction === "inbound" ? ("RECEIVED" as const) : ("SENT" as const)),
        createdAt: new Date(m.createdAt),
      }));
    const { count } = await db.whatsappMessage.createMany({ data: rows, skipDuplicates: true });
    const newest = await db.whatsappMessage.findFirst({ where: { customerId }, orderBy: { createdAt: "desc" } });
    const lastInbound = history.contact?.window?.lastInboundAt;
    const fields = {
      lastMessage: newest?.content,
      lastMessageAt: newest?.createdAt,
      ...(lastInbound ? { lastInboundAt: new Date(lastInbound) } : {}),
    };
    await db.whatsappConversation.upsert({ where: { customerId }, create: { customerId, ...fields }, update: fields });
    return { imported: count };
  } catch (err) {
    if (err instanceof SendieeError) {
      throw new ApiError(502, err.code, err.code === "NOT_CONFIGURED" ? "WhatsApp is not configured yet" : err.message);
    }
    throw err;
  }
}
