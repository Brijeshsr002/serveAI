import { Prisma as PrismaNamespace, type Customer, type Prisma } from "@prisma/client";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { rupees } from "@/lib/format";
import { sendFreeformText } from "@/lib/notifications";
import { PaymentService } from "@/lib/payments";
import { normalizeRegistration } from "@/lib/phone";
import { decideItems } from "@/lib/services/invoices";
import { ratedServices } from "@/lib/services/service-rates";
import { type BookingPending, continueBooking, isBookingRequest, startBooking } from "@/lib/services/whatsapp-booking";
import { getSettings, trackingUrl, appUrl } from "@/lib/settings";
import { ACTIVE_STATUSES, STATUS_LABEL } from "@/lib/status";

export type Intent = "STATUS" | "AMOUNT" | "PAYMENT" | "INVOICE";

export function detectIntent(text: string): Intent | null {
  const t = text.toLowerCase();
  if (/\b(payment link|pay now|pay link|payment)\b/.test(t)) return "PAYMENT";
  if (/\b(invoice|bill)\b/.test(t)) return "INVOICE";
  if (/\b(how much|amount|cost|charge|price|total)\b/.test(t)) return "AMOUNT";
  if (/\b(status|ready|update|progress|where is my)\b/.test(t)) return "STATUS";
  return null;
}

const jobInclude = { vehicle: true, invoice: true, payments: { where: { status: "PAID" as const }, take: 1 } };
type Job = Prisma.ServiceJobGetPayload<{ include: typeof jobInclude }>;

const vehicleLabel = (j: Job) => `${j.vehicle.brand} ${j.vehicle.model} ${j.vehicle.registrationNumber}`;

/** Active jobs, plus finished ones still unpaid, so "how much?" works after delivery. */
function relevantJobs(customerId: string, intent: Intent) {
  const where: Prisma.ServiceJobWhereInput =
    intent === "STATUS"
      ? { customerId, status: { in: ACTIVE_STATUSES } }
      : {
          customerId,
          OR: [
            { status: { in: ACTIVE_STATUSES } },
            { status: "COMPLETED", invoice: { isNot: null }, payments: { none: { status: "PAID" } } },
          ],
        };
  return db.serviceJob.findMany({ where, include: jobInclude, orderBy: { createdAt: "desc" } });
}

async function answer(intent: Intent, job: Job): Promise<string> {
  const paid = job.payments.length > 0;
  const total = job.invoice?.total ?? job.finalAmount;
  switch (intent) {
    case "STATUS":
      return `Your ${vehicleLabel(job)} is currently under ${STATUS_LABEL[job.status]}.\nTrack it here: ${trackingUrl(job.trackingToken)}`;
    case "AMOUNT":
      if (total) return `The final amount for your ${vehicleLabel(job)} is ${rupees(total)}${paid ? " (paid)" : ""}.`;
      if (job.estimatedAmount) return `The estimated amount for your ${vehicleLabel(job)} is ${rupees(job.estimatedAmount)}. The final amount is confirmed once work is done.`;
      return `The amount for your ${vehicleLabel(job)} isn't confirmed yet. We'll update you soon.`;
    case "INVOICE":
      if (!job.invoice) return `The invoice for your ${vehicleLabel(job)} isn't ready yet.`;
      return `Invoice ${job.invoice.invoiceNumber}:\n${appUrl()}/api/track/${job.trackingToken}/invoice`;
    case "PAYMENT": {
      if (paid) return `Payment for your ${vehicleLabel(job)} is already complete. Thank you!`;
      if (!job.invoice) return `The bill for your ${vehicleLabel(job)} isn't ready yet. We'll send the payment link once it is.`;
      try {
        const { payment } = await PaymentService.getOrCreateForJob(SYSTEM_ACTOR, job.id);
        return `Final amount: ${rupees(job.invoice.total)}\nPay securely here:\n${payment.paymentLink}`;
      } catch (err) {
        if (err instanceof ApiError) return `We can't create a payment link right now. Please view your bill here: ${trackingUrl(job.trackingToken)}`;
        throw err;
      }
    }
  }
}

type JobPending = { intent: Intent; jobIds: string[] };
type Pending = JobPending | BookingPending;

/** Resolves "1" or a registration number against the list we last offered. */
async function matchPendingChoice(pending: JobPending, text: string) {
  const trimmed = text.trim();
  const index = /^\d{1,2}$/.test(trimmed) ? Number(trimmed) - 1 : -1;
  const jobs = await db.serviceJob.findMany({ where: { id: { in: pending.jobIds } }, include: jobInclude });
  const ordered = pending.jobIds.map((id) => jobs.find((j) => j.id === id)).filter((j): j is Job => Boolean(j));
  if (index >= 0) return ordered[index] ?? null;
  const reg = normalizeRegistration(trimmed);
  return reg.length >= 4 ? (ordered.find((j) => j.vehicle.registrationNumber.includes(reg)) ?? null) : null;
}

/** Returns the reply text for a customer message, or null if it isn't a command. */
export async function replyForMessage(customer: Customer, text: string): Promise<{ reply: string; jobId?: string } | null> {
  const conversation = await db.whatsappConversation.findUnique({ where: { customerId: customer.id } });
  const pending = conversation?.pendingChoice as Pending | null | undefined;

  const settings = await getSettings();
  const bookingOn = settings.booking_enabled === "true";

  if (pending?.intent === "BOOK") {
    if (bookingOn) {
      const next = await continueBooking(customer, pending, text, settings);
      if (next) return next;
    }
  } else if (pending) {
    const job = await matchPendingChoice(pending, text);
    if (job) {
      await db.whatsappConversation.update({ where: { customerId: customer.id }, data: { pendingChoice: PrismaNamespace.DbNull } });
      return { reply: await answer(pending.intent, job), jobId: job.id };
    }
  }

  const intent = detectIntent(text);
  if (!intent) {
    if (bookingOn && isBookingRequest(text)) {
      // A conversation row exists for every inbound message, but a direct call may come first.
      await db.whatsappConversation.upsert({ where: { customerId: customer.id }, create: { customerId: customer.id }, update: {} });
      return { reply: await startBooking(customer, settings) };
    }
    return null;
  }

  const jobs = await relevantJobs(customer.id, intent);
  if (jobs.length === 0) {
    // "How much?" from someone with no job is an enquiry, so answer with the default prices.
    const rates = intent === "AMOUNT" ? await ratedServices() : [];
    if (rates.length > 0) {
      const list = rates.map((r) => `${r.name}: ${rupees(r.rate)}`).join("\n");
      return { reply: `Our prices:\n${list}\n\nFinal prices depend on your car. Send BOOK to choose a time.` };
    }
    return { reply: "You don't have an active service with us right now. Reply here to book one." };
  }
  if (jobs.length === 1) return { reply: await answer(intent, jobs[0]), jobId: jobs[0].id };

  const list = jobs.map((j, i) => `${i + 1}. ${j.vehicle.brand} ${j.vehicle.model} — ${j.vehicle.registrationNumber} — ${STATUS_LABEL[j.status]}`).join("\n");
  await db.whatsappConversation.update({
    where: { customerId: customer.id },
    data: { pendingChoice: { intent, jobIds: jobs.map((j) => j.id) } },
  });
  return { reply: `You have ${jobs.length} active vehicles:\n\n${list}\n\nWhich vehicle would you like to check?` };
}

/**
 * An exact YES or NO answers extra work, but only a line we really asked this customer about.
 * With more than one line waiting, a single word can't say which, so they choose on the tracking page.
 */
export async function approvalReply(customer: Customer, text: string): Promise<{ reply: string; jobId?: string } | null> {
  const answer = text.trim().replace(/[.!]+$/, "").toLowerCase();
  const approve = ["yes", "approve", "approved"].includes(answer);
  if (!approve && !["no", "decline", "reject"].includes(answer)) return null;
  const items = await db.serviceItem.findMany({
    where: { approval: "PENDING", serviceJob: { customerId: customer.id, status: { in: ACTIVE_STATUSES }, payments: { none: { status: "PAID" } } } },
    include: { serviceJob: { select: { trackingToken: true } } },
    orderBy: { createdAt: "asc" },
  });
  const sent = await db.notification.findMany({ where: { customerId: customer.id, kind: "ITEM_APPROVAL", status: "SENT" }, select: { serviceJobId: true, createdAt: true } });
  const asked = items.filter((i) => sent.some((n) => n.serviceJobId === i.serviceJobId && n.createdAt >= i.updatedAt));
  if (asked.length === 0) return null;
  if (items.length > 1) {
    const lines = items.map((i) => `- ${i.name}: ${rupees(i.total)}`).join("\n");
    const links = [...new Set(items.map((i) => trackingUrl(i.serviceJob.trackingToken)))].join("\n");
    return { reply: `You have ${items.length} items waiting for your OK:\n${lines}\n\nPlease choose each one here:\n${links}` };
  }
  const [item] = asked;
  const actor = { id: null, role: "CUSTOMER", name: customer.name };
  const decided = await decideItems(actor, item.serviceJobId, [item.id], approve);
  if (decided.length === 0) return null;
  return {
    jobId: item.serviceJobId,
    reply: approve ? `Thank you! We've added ${item.name} (${rupees(item.total)}) to your service.` : `No problem, we won't do ${item.name}.`,
  };
}

export async function runCommands(customer: Customer, text: string) {
  const answered = await approvalReply(customer, text);
  if (answered) {
    await sendFreeformText({ customerId: customer.id, phone: customer.phone, serviceJobId: answered.jobId, text: answered.reply })
      .catch((err) => console.error("Approval reply failed:", (err as Error).message));
    return;
  }
  const settings = await getSettings();
  if (settings.whatsapp_commands_enabled !== "true") return;
  const result = await replyForMessage(customer, text);
  if (!result) return;
  await sendFreeformText({
    customerId: customer.id,
    phone: customer.phone,
    serviceJobId: result.jobId,
    text: result.reply,
  }).catch((err) => console.error("Command reply failed:", (err as Error).message));
}
