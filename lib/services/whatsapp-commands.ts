import { Prisma as PrismaNamespace, type Customer, type Prisma } from "@prisma/client";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { rupees } from "@/lib/format";
import { sendFreeformText } from "@/lib/notifications";
import { PaymentService } from "@/lib/payments";
import { normalizeRegistration } from "@/lib/phone";
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

type Pending = { intent: Intent; jobIds: string[] };

/** Resolves "1" or a registration number against the list we last offered. */
async function matchPendingChoice(pending: Pending, text: string) {
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

  if (pending) {
    const job = await matchPendingChoice(pending, text);
    if (job) {
      await db.whatsappConversation.update({ where: { customerId: customer.id }, data: { pendingChoice: PrismaNamespace.DbNull } });
      return { reply: await answer(pending.intent, job), jobId: job.id };
    }
  }

  const intent = detectIntent(text);
  if (!intent) return null;

  const jobs = await relevantJobs(customer.id, intent);
  if (jobs.length === 0) return { reply: "You don't have an active service with us right now. Reply here to book one." };
  if (jobs.length === 1) return { reply: await answer(intent, jobs[0]), jobId: jobs[0].id };

  const list = jobs.map((j, i) => `${i + 1}. ${j.vehicle.brand} ${j.vehicle.model} — ${j.vehicle.registrationNumber} — ${STATUS_LABEL[j.status]}`).join("\n");
  await db.whatsappConversation.update({
    where: { customerId: customer.id },
    data: { pendingChoice: { intent, jobIds: jobs.map((j) => j.id) } },
  });
  return { reply: `You have ${jobs.length} active vehicles:\n\n${list}\n\nWhich vehicle would you like to check?` };
}

export async function runCommands(customer: Customer, text: string) {
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
