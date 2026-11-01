import { logActivity, SYSTEM_ACTOR } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import { db, isUniqueViolation } from "@/lib/db";
import { ApiError, conflict, notFound } from "@/lib/errors";
import { toNumber } from "@/lib/format";
import { loadJobContext, NotificationService, type NotifyOutcome, whatsappFailure } from "@/lib/notifications";
import { trackingUrl } from "@/lib/settings";
import { razorpay } from "./razorpay";
import { stripe } from "./stripe";
import type { PaymentEvent, PaymentProvider, WebhookHeaders } from "./types";

const PROVIDERS: PaymentProvider[] = [razorpay, stripe];

function activeProvider() {
  const name = process.env.PAYMENT_PROVIDER ?? "razorpay";
  const provider = PROVIDERS.find((p) => p.name === name);
  if (!provider?.isConfigured()) {
    throw new ApiError(503, "PAYMENT_NOT_CONFIGURED", "Online payments are not set up yet");
  }
  return provider;
}

export const providerForWebhook = (headers: WebhookHeaders) => PROVIDERS.find((p) => p.matchesWebhook(headers));

/** What to tell someone whose new link was made but whose message didn't clearly go out. The link stands either way. */
function newLinkWarning(outcome: NotifyOutcome) {
  if (outcome.status === "SENT") return null;
  if (outcome.status === "SKIPPED") return `Payment link created, but no WhatsApp message was sent: ${outcome.detail}`;
  return `Payment link created. ${whatsappFailure(outcome).message}`;
}

export const PaymentService = {
  /**
   * Returns the job's open payment link, creating one if needed. The amount always comes
   * from the server-side invoice; no caller can supply it.
   * Only a new link is messaged, so a double click can't reach the customer twice. `warning` is set
   * when notifyCustomer was asked for and the customer may not have the message; sendReminder resends an open link.
   */
  async getOrCreateForJob(actor: Actor, jobId: string, { notifyCustomer = false } = {}) {
    const job = await db.serviceJob.findUnique({
      where: { id: jobId },
      include: { invoice: true, customer: true },
    });
    if (!job) throw notFound("SERVICE_NOT_FOUND", "Service job not found");
    if (job.status === "CANCELLED") throw conflict("SERVICE_CLOSED", "This service was cancelled");
    if (!job.invoice) throw conflict("INVOICE_REQUIRED", "Generate an invoice before requesting payment");
    if (await db.payment.findFirst({ where: { serviceJobId: jobId, status: "PAID" } })) {
      throw conflict("SERVICE_ALREADY_PAID", "This service is already paid");
    }

    const amount = toNumber(job.invoice.total);
    const amountPaise = Math.round(amount * 100);
    if (amountPaise <= 0) throw conflict("NOTHING_TO_PAY", "The invoice total is zero");

    const open = await db.payment.findFirst({
      where: { serviceJobId: jobId, status: { in: ["PENDING", "PROCESSING"] } },
    });
    if (open) {
      if (open.paymentLink && toNumber(open.amount) === amount) {
        const warning = notifyCustomer ? "This job already has an open payment link, so no WhatsApp message was sent. Use Resend payment link to send it again." : null;
        return { payment: open, created: false, notification: null, warning };
      }
      // The bill changed since this link went out, so the old link must not stay payable.
      await this.cancelOpenPayment(open.id, open.paymentProvider, open.paymentOrderId);
    }

    const provider = activeProvider();
    let row;
    try {
      row = await db.payment.create({
        data: {
          serviceJobId: jobId,
          customerId: job.customerId,
          amount,
          currency: "INR",
          paymentProvider: provider.name,
          status: "PENDING",
        },
      });
    } catch (err) {
      // payments_one_open_per_job: someone else is creating this link right now.
      if (isUniqueViolation(err)) throw conflict("PAYMENT_IN_PROGRESS", "A payment link is being created. Try again shortly.");
      throw err;
    }

    let link;
    try {
      link = await provider.createPaymentLink({
        reference: row.id,
        amountPaise,
        currency: "INR",
        description: `Service ${job.serviceNumber}`,
        customer: { name: job.customer.name, phone: job.customer.phone, email: job.customer.email },
        callbackUrl: trackingUrl(job.trackingToken),
      });
    } catch (err) {
      await db.payment.delete({ where: { id: row.id } });
      throw err;
    }

    const payment = await db.payment.update({
      where: { id: row.id },
      data: { paymentOrderId: link.orderId, paymentLink: link.url },
    });
    await logActivity(actor, {
      action: "PAYMENT_LINK_CREATED",
      entityType: "Payment",
      entityId: payment.id,
      summary: `${actor.name} created a payment link for ${job.serviceNumber}`,
      metadata: { amount, provider: provider.name },
    });
    const notification = notifyCustomer ? await NotificationService.sendPaymentRequest(await loadJobContext(jobId), amount, link.url) : null;
    return { payment, created: true, notification, warning: notification && newLinkWarning(notification) };
  },

  /**
   * Sends the open link again through the normal payment-request message. It never creates a link or touches
   * the amount, and only returns if the message went out: anything else reaches the caller as an error.
   */
  async sendReminder(actor: Actor, paymentId: string) {
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      include: { serviceJob: { select: { serviceNumber: true, status: true, invoice: { select: { total: true } } } } },
    });
    if (!payment) throw notFound("PAYMENT_NOT_FOUND", "Payment not found");
    if (payment.status === "PAID") throw conflict("PAYMENT_ALREADY_PAID", "This payment is already paid, so no reminder was sent");
    if (payment.status !== "PENDING" && payment.status !== "PROCESSING") {
      throw conflict("PAYMENT_NOT_OPEN", `This payment is ${payment.status.toLowerCase()}, so no reminder was sent`);
    }
    if (!payment.paymentLink) throw conflict("PAYMENT_LINK_MISSING", "This payment has no link to send. Create a payment request from the service job.");
    const job = payment.serviceJob;
    if (job.status === "CANCELLED") throw conflict("SERVICE_CLOSED", "This service was cancelled, so no reminder was sent");
    if (await db.payment.findFirst({ where: { serviceJobId: payment.serviceJobId, status: "PAID" } })) {
      throw conflict("SERVICE_ALREADY_PAID", "This service is already paid, so no reminder was sent");
    }
    const amount = toNumber(payment.amount);
    if (job.invoice && toNumber(job.invoice.total) !== amount) {
      throw conflict("BILL_CHANGED", "The bill has changed since this link was made, so no reminder was sent. Create a new payment request from the service job.");
    }

    const outcome = await NotificationService.sendPaymentRequest(await loadJobContext(payment.serviceJobId), amount, payment.paymentLink);
    const reason = outcome.status === "SKIPPED" ? outcome.detail : outcome.status === "FAILED" ? outcome.code : null;
    const result = outcome.status === "FAILED" && outcome.unconfirmed ? "could not be confirmed" : "was not sent";
    await logActivity(actor, {
      action: `PAYMENT_REMINDER_${outcome.status}`,
      entityType: "Payment",
      entityId: payment.id,
      summary: reason ? `${actor.name}'s payment reminder for ${job.serviceNumber} ${result}: ${reason}` : `${actor.name} sent a payment reminder for ${job.serviceNumber}`,
      metadata: { amount, ...(reason ? { reason } : {}) },
    });
    if (outcome.status === "SKIPPED") throw conflict("REMINDER_NOT_SENT", `No reminder was sent: ${outcome.detail}`);
    if (outcome.status === "FAILED") throw whatsappFailure(outcome);
    return { status: outcome.status };
  },

  async cancelOpenPayment(paymentId: string, providerName: string, orderId: string | null) {
    await db.payment.update({ where: { id: paymentId }, data: { status: "CANCELLED" } });
    const provider = PROVIDERS.find((p) => p.name === providerName);
    if (orderId && provider?.isConfigured()) {
      await provider.cancelPaymentLink(orderId).catch((err) => {
        console.error(`Could not cancel ${providerName} link ${orderId}:`, (err as Error).message);
      });
    }
  },

  /** Applies a verified provider event. Status only ever comes from here, never from a browser. */
  async applyEvent(provider: PaymentProvider, event: PaymentEvent) {
    if (event.type === "IGNORED") return "ignored";

    const payment = await db.payment.findFirst({
      where: {
        paymentProvider: provider.name,
        ...(event.orderId ? { paymentOrderId: event.orderId } : { paymentId: event.paymentId ?? "__none__" }),
      },
    });
    if (!payment) {
      console.error(`Payment webhook ${event.rawType}: no payment for ${event.orderId ?? event.paymentId}`);
      return "unmatched";
    }

    if (event.type === "PAID") {
      if (event.amountPaise !== undefined && event.amountPaise !== Math.round(toNumber(payment.amount) * 100)) {
        await logActivity(SYSTEM_ACTOR, {
          action: "PAYMENT_AMOUNT_MISMATCH",
          entityType: "Payment",
          entityId: payment.id,
          summary: `Payment webhook amount does not match payment ${payment.id}; not marked paid`,
          metadata: { expectedPaise: Math.round(toNumber(payment.amount) * 100), receivedPaise: event.amountPaise },
        });
        return "amount_mismatch";
      }
      // Only one concurrent delivery can flip this row, so only one confirmation goes out.
      // In one transaction, so a failure rolls back the flip and the provider's retry still confirms.
      const flipped = await db.$transaction(async (tx) => {
        const { count } = await tx.payment.updateMany({
          where: { id: payment.id, status: { not: "PAID" } },
          data: { status: "PAID", paymentId: event.paymentId, paidAt: new Date() },
        });
        if (count === 0) return false;
        await logActivity(
          { ...SYSTEM_ACTOR, role: "CUSTOMER", name: "Customer" },
          {
            action: "PAYMENT_RECEIVED",
            entityType: "Payment",
            entityId: payment.id,
            summary: `Customer payment completed: ₹${toNumber(payment.amount)}`,
            metadata: { provider: provider.name, paymentId: event.paymentId ?? null },
          },
          tx,
        );
        return true;
      });
      if (!flipped) return "already_paid";
      await NotificationService.sendPaymentConfirmation(await loadJobContext(payment.serviceJobId), payment.amount);
      return "paid";
    }

    if (event.type === "REFUNDED") {
      await db.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
      await logActivity(SYSTEM_ACTOR, {
        action: "PAYMENT_REFUNDED",
        entityType: "Payment",
        entityId: payment.id,
        summary: `Payment refunded: ₹${toNumber(payment.amount)}`,
      });
      return "refunded";
    }

    // Late cancel/fail events must not undo a completed payment.
    await db.payment.updateMany({
      where: { id: payment.id, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: event.type },
    });
    return event.type.toLowerCase();
  },
};
