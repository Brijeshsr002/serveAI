import type { Customer, MessageStatus, ServiceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, conflict } from "@/lib/errors";
import { rupees } from "@/lib/format";
import { SendieeError, sendieeClient } from "@/lib/sendiee";
import type { StepKey } from "@/lib/message-steps";
import { appUrl, fill, getSettings, statusMessageKey, trackingUrl } from "@/lib/settings";
import { STATUS_LABEL } from "@/lib/status";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export type JobContext = {
  id: string;
  serviceNumber: string;
  trackingToken: string;
  customer: Customer;
  vehicle: { brand: string; model: string; registrationNumber: string };
};

const JOB_INCLUDE = { customer: true, vehicle: true } as const;

export const loadJobContext = (id: string) =>
  db.serviceJob.findUniqueOrThrow({ where: { id }, include: JOB_INCLUDE });

export async function isWindowOpen(customerId: string) {
  const conversation = await db.whatsappConversation.findUnique({ where: { customerId } });
  return Boolean(conversation?.lastInboundAt && Date.now() - conversation.lastInboundAt.getTime() < WINDOW_MS);
}

export function mapSendieeStatus(status: string | null | undefined): MessageStatus | null {
  const map: Record<string, MessageStatus> = {
    accepted: "ACCEPTED",
    sent: "SENT",
    delivered: "DELIVERED",
    read: "READ",
    failed: "FAILED",
    received: "RECEIVED",
  };
  return map[(status ?? "").toLowerCase()] ?? null;
}

async function touchConversation(customerId: string, text: string) {
  await db.whatsappConversation.upsert({
    where: { customerId },
    create: { customerId, lastMessage: text, lastMessageAt: new Date() },
    update: { lastMessage: text, lastMessageAt: new Date() },
  });
}

/** What became of a message. Automatic notifications ignore it; a send someone asked for must report it. */
export type NotifyOutcome =
  | { status: "SENT" }
  | { status: "SKIPPED"; detail: string }
  | { status: "FAILED"; code: string; message: string; unconfirmed: boolean };

/**
 * The error for someone who pressed a send button. Says plainly whether anything went out, and doesn't name server settings.
 * An unconfirmed send must not read as a clean failure, or they press again and the customer gets it twice.
 */
export function whatsappFailure({ code, message, unconfirmed }: { code: string; message: string; unconfirmed: boolean }) {
  if (code === "NOT_CONFIGURED") return new ApiError(503, "WHATSAPP_NOT_CONFIGURED", "WhatsApp isn't set up yet, so nothing was sent. Add the Sendiee API key and brand number first.");
  if (unconfirmed) return new ApiError(502, code, "Couldn't confirm with WhatsApp, so the message may or may not have gone out. Check the WhatsApp inbox before trying again.");
  return new ApiError(502, code, `WhatsApp didn't take the message, so nothing was sent: ${message}`);
}

type SendSpec = { customerId: string; phone: string; serviceJobId?: string | null; text: string };

/** Stores the outbound message, sends it, and records the result. Throws SendieeError on failure. */
async function deliver(spec: SendSpec, messageType: string, send: () => Promise<{ messageId: string }>) {
  const message = await db.whatsappMessage.create({
    data: {
      customerId: spec.customerId,
      serviceJobId: spec.serviceJobId ?? null,
      direction: "OUTBOUND",
      messageType,
      content: spec.text,
      status: "QUEUED",
    },
  });
  await touchConversation(spec.customerId, spec.text);
  try {
    const result = await send();
    return await db.whatsappMessage.update({
      where: { id: message.id },
      data: { sendieeMessageId: result.messageId, status: "ACCEPTED" },
    });
  } catch (err) {
    const code = err instanceof SendieeError ? `${err.code}: ${err.message}` : "UNKNOWN_ERROR";
    await db.whatsappMessage.update({ where: { id: message.id }, data: { status: "FAILED", error: code } });
    throw err;
  }
}

export const sendFreeformText = (spec: SendSpec) =>
  deliver(spec, "text", () => sendieeClient.sendMessage(spec.phone, "text", { body: spec.text }));

export const sendTemplateText = (spec: SendSpec, templateName: string, bodyParameters: string[], language = "en") =>
  deliver(spec, "template", () => sendieeClient.sendTemplate({ to: spec.phone, templateName, language, bodyParameters }));

export const sendDocument = (spec: SendSpec, link: string, filename: string) =>
  deliver(spec, "document", () => sendieeClient.sendMessage(spec.phone, "document", { link, filename, caption: spec.text }));

/**
 * Automatic notifications never throw: a WhatsApp outage must not undo a status change or payment.
 * The returned outcome is the only sign a message didn't go out.
 * Always freeform text. WhatsApp itself may refuse it when the customer hasn't messaged in 24 hours; that's recorded as FAILED.
 */
async function notify(args: {
  kind: string;
  customer: Customer;
  serviceJobId: string;
  text: string;
  templateName: string;
  templateParams: string[];
  language: string;
}): Promise<NotifyOutcome> {
  const spec: SendSpec = {
    customerId: args.customer.id,
    phone: args.customer.phone,
    serviceJobId: args.serviceJobId,
    text: args.text,
  };
  const record = (status: "SENT" | "FAILED" | "SKIPPED", detail?: string) =>
    db.notification.create({
      data: { customerId: args.customer.id, serviceJobId: args.serviceJobId, kind: args.kind, status, detail },
    });

  if (!args.text.trim()) {
    const detail = "Message is blank in Customer Messages";
    await record("SKIPPED", detail);
    return { status: "SKIPPED", detail };
  }

  try {
    await sendFreeformText(spec);
    await record("SENT");
    return { status: "SENT" };
  } catch (err) {
    const detail = err instanceof SendieeError ? err.code : "UNKNOWN_ERROR";
    console.error(`Notification ${args.kind} failed: ${detail}`);
    await record("FAILED", detail);
    // Anything other than a SendieeError has no answer from Sendiee behind it, e.g. an unreadable reply to an accepted send.
    return { status: "FAILED", code: detail, message: err instanceof SendieeError ? err.message : "Unknown error", unconfirmed: err instanceof SendieeError ? err.unconfirmed : true };
  }
}

type Settings = Awaited<ReturnType<typeof getSettings>>;

const vars = (job: JobContext, settings: Settings, extra: Record<string, string> = {}) => ({
  customer_name: job.customer.name,
  service_number: job.serviceNumber,
  vehicle_model: `${job.vehicle.brand} ${job.vehicle.model}`,
  registration: job.vehicle.registrationNumber,
  tracking_link: trackingUrl(job.trackingToken),
  garage_name: settings.center_name,
  garage_phone: settings.center_phone,
  ...extra,
});

/** Sends one step of the message map, honouring its on/off switch and its own template if it has one. */
async function notifyStep(args: {
  step: StepKey;
  kind: string;
  job: JobContext;
  settings: Settings;
  text: string;
  defaultTemplate: string;
  templateParams: string[];
}): Promise<NotifyOutcome> {
  const { step, kind, job, settings } = args;
  if (settings[`notify_${step}`] === "false") {
    const detail = "Turned off in Customer Messages";
    await db.notification.create({
      data: { customerId: job.customer.id, serviceJobId: job.id, kind, status: "SKIPPED", detail },
    });
    return { status: "SKIPPED", detail };
  }
  return notify({
    kind,
    customer: job.customer,
    serviceJobId: job.id,
    text: args.text,
    templateName: settings[`tpl_${step}`] || args.defaultTemplate,
    templateParams: args.templateParams,
    language: settings.template_language,
  });
}

export const NotificationService = {
  async sendServiceStatusUpdate(job: JobContext, status: ServiceStatus, finalAmount?: unknown) {
    const settings = await getSettings();
    let text = fill(settings[statusMessageKey(status)], vars(job, settings));
    if (status === "READY_FOR_DELIVERY" && finalAmount) text += `\nFinal amount: ${rupees(finalAmount as number)}`;
    await notifyStep({
      step: status,
      kind: `STATUS_${status}`,
      job,
      settings,
      text,
      defaultTemplate: settings.template_status_update,
      templateParams: [job.customer.name, job.serviceNumber, STATUS_LABEL[status], trackingUrl(job.trackingToken)],
    });
  },

  /** A part, labour or cost changed. Outside the window, the status template carries the change as its status text. */
  async sendBillChange(job: JobContext, step: "ITEM_APPROVAL" | "ITEM_ADDED" | "ITEM_UPDATED" | "ITEM_REMOVED", item: { name: string; cost: unknown }, billTotal: number) {
    const settings = await getSettings();
    const cost = rupees(item.cost as number);
    const total = rupees(billTotal);
    const summary = { ITEM_APPROVAL: `Approval needed for ${item.name} (${cost})`, ITEM_ADDED: `Added ${item.name} (${cost})`, ITEM_UPDATED: `Updated ${item.name} to ${cost}`, ITEM_REMOVED: `Removed ${item.name}` }[step];
    await notifyStep({
      step,
      kind: step,
      job,
      settings,
      text: fill(settings[`msg_${step}`], vars(job, settings, { item_name: item.name, item_cost: cost, bill_total: total })),
      defaultTemplate: settings.template_status_update,
      templateParams: [job.customer.name, job.serviceNumber, `${summary}. Bill now ${total}`, trackingUrl(job.trackingToken)],
    });
  },

  sendServiceCompletion(job: JobContext) {
    return NotificationService.sendServiceStatusUpdate(job, "COMPLETED");
  },

  async sendServiceRequestReceived(job: JobContext) {
    const settings = await getSettings();
    await notifyStep({
      step: "NEW",
      kind: "SERVICE_REQUEST_RECEIVED",
      job,
      settings,
      text: fill(settings.msg_NEW, vars(job, settings)),
      defaultTemplate: settings.template_status_update,
      templateParams: [job.customer.name, job.serviceNumber, STATUS_LABEL.NEW, trackingUrl(job.trackingToken)],
    });
  },

  async sendPaymentRequest(job: JobContext, amount: unknown, paymentLink: string) {
    const settings = await getSettings();
    return notifyStep({
      step: "PAYMENT_REQUEST",
      kind: "PAYMENT_REQUEST",
      job,
      settings,
      text: fill(settings.msg_PAYMENT_REQUEST, vars(job, settings, { amount: rupees(amount as number), payment_link: paymentLink })),
      defaultTemplate: settings.template_payment_request,
      templateParams: [job.customer.name, rupees(amount as number), job.serviceNumber, paymentLink],
    });
  },

  async sendPaymentConfirmation(job: JobContext, amount: unknown) {
    const settings = await getSettings();
    await notifyStep({
      step: "PAYMENT_CONFIRMATION",
      kind: "PAYMENT_CONFIRMATION",
      job,
      settings,
      text: fill(settings.msg_PAYMENT_CONFIRMATION, vars(job, settings, { amount: rupees(amount as number) })),
      defaultTemplate: settings.template_payment_confirmation,
      templateParams: [job.customer.name, rupees(amount as number), job.serviceNumber],
    });
  },

  /** Sends the invoice PDF. */
  async sendInvoice(job: JobContext, invoiceNumber: string) {
    const settings = await getSettings();
    const link = `${appUrl()}/api/track/${job.trackingToken}/invoice`;
    const spec: SendSpec = {
      customerId: job.customer.id,
      phone: job.customer.phone,
      serviceJobId: job.id,
      text: fill(settings.msg_INVOICE, vars(job, settings, { invoice_number: invoiceNumber })),
    };
    await sendDocument(spec, link, `${invoiceNumber}.pdf`);
    await db.notification.create({
      data: { customerId: job.customer.id, serviceJobId: job.id, kind: "INVOICE", status: "SENT" },
    });
  },
};
