import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { rupees } from "@/lib/format";
import { MESSAGE_STEPS } from "@/lib/message-steps";
import { appUrl, getSettings, trackingUrl } from "@/lib/settings";
import { ACTIVE_STATUSES, STATUS_LABEL } from "@/lib/status";

/** Like fill(), but keeps a placeholder with no value, so staff see what still needs typing. */
const fillKnown = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (whole, k) => vars[k] || whole);

/** Everything the typing bar can offer this customer, with their details already filled in. */
export async function composerTemplates(customerId: string) {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  const include = {
    vehicle: true,
    invoice: { select: { invoiceNumber: true, total: true } },
    payments: { where: { status: { in: ["PENDING", "PROCESSING"] as ("PENDING" | "PROCESSING")[] } }, take: 1, select: { paymentLink: true } },
  };
  const newest = { createdAt: "desc" as const };
  const job =
    (await db.serviceJob.findFirst({ where: { customerId, status: { in: ACTIVE_STATUSES } }, orderBy: newest, include })) ??
    (await db.serviceJob.findFirst({ where: { customerId }, orderBy: newest, include }));
  const settings = await getSettings();

  const amount = job?.invoice?.total ?? job?.finalAmount ?? job?.estimatedAmount;
  const link = job ? trackingUrl(job.trackingToken) : "";
  const paymentLink = job?.payments[0]?.paymentLink ?? "";
  const vars: Record<string, string> = {
    customer_name: customer.name,
    service_number: job?.serviceNumber ?? "",
    vehicle_model: job ? `${job.vehicle.brand} ${job.vehicle.model}` : "",
    registration: job?.vehicle.registrationNumber ?? "",
    tracking_link: link,
    garage_name: settings.center_name,
    garage_phone: settings.center_phone,
    amount: amount ? rupees(amount) : "",
    payment_link: paymentLink,
    invoice_number: job?.invoice?.invoiceNumber ?? "",
  };

  const messages = MESSAGE_STEPS.filter((s) => !s.key.startsWith("ITEM_")).map((s) => ({
    key: s.key,
    label: s.label,
    text: fillKnown(settings[`msg_${s.key}`], vars),
  }));

  const name = { label: "Customer name", value: customer.name };
  const number = { label: "Service number", value: vars.service_number };
  const money = { label: "Amount", value: vars.amount };
  const approved = [
    {
      name: settings.template_status_update,
      label: "Status update",
      body: "Hi {{1}}, here's an update on your vehicle service {{2}}: {{3}}. Track it here: {{4}}",
      params: [name, number, { label: "Status", value: job ? STATUS_LABEL[job.status] : "" }, { label: "Tracking link", value: link }],
    },
    {
      name: settings.template_payment_request,
      label: "Payment request",
      body: "Hi {{1}}, your final service amount is {{2}} for {{3}}. Pay securely here: {{4}}",
      params: [name, money, number, { label: "Payment link", value: paymentLink }],
    },
    {
      name: settings.template_payment_confirmation,
      label: "Payment received",
      body: "Hi {{1}}, we've received your payment of {{2}} for {{3}}. Thank you!",
      params: [name, money, number],
    },
    {
      name: settings.template_invoice,
      label: "Invoice",
      body: "Hi {{1}}, your invoice {{2}} for {{3}} is ready: {{4}}",
      params: [
        name,
        { label: "Invoice number", value: vars.invoice_number },
        number,
        { label: "Invoice link", value: job?.invoice ? `${appUrl()}/api/track/${job.trackingToken}/invoice` : "" },
      ],
    },
  ].filter((t) => t.name);

  return { serviceJobId: job?.id ?? null, messages, approved };
}

export type ComposerTemplates = Awaited<ReturnType<typeof composerTemplates>>;
