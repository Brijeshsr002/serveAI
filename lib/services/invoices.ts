import { ItemType, Prisma } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import type { SessionUser } from "@/lib/auth/session";
import { db, isUniqueViolation, nextInvoiceNumber } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { toNumber } from "@/lib/format";
import { loadJobContext, NotificationService } from "@/lib/notifications";
import { isTerminal } from "@/lib/status";

const amount = z.coerce.number().min(0).max(100_000_000);

export const itemSchema = z.object({
  itemType: z.enum(ItemType),
  name: z.string().trim().min(1, "Name is required").max(160),
  description: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
  quantity: z.coerce.number().positive("Quantity must be above zero").max(100_000).default(1),
  unitPrice: amount,
  tax: amount.default(0),
  discount: amount.default(0),
  /** Staff choose; a worker's change always tells the customer. */
  notifyCustomer: z.boolean().optional(),
});

type ItemInput = z.output<typeof itemSchema>;
type ItemUser = Pick<SessionUser, "id" | "role">;

/** Arithmetic in paise, so 0.1 + 0.2 style float errors never reach an invoice. */
const toPaise = (rupees: number) => Math.round(rupees * 100);
const fromPaise = (paise: number) => paise / 100;

export function lineTotal(item: { quantity: number; unitPrice: number; tax: number; discount: number }) {
  const paise = Math.round(item.quantity * toPaise(item.unitPrice)) + toPaise(item.tax) - toPaise(item.discount);
  return fromPaise(Math.max(paise, 0));
}

async function assertNotPaid(jobId: string) {
  const paid = await db.payment.findFirst({ where: { serviceJobId: jobId, status: "PAID" } });
  if (paid) throw conflict("SERVICE_ALREADY_PAID", "This service is already paid and its bill can no longer change");
}

/** Loads a job whose bill this user may change. Workers only reach their own open jobs with no payment link out. */
async function editableJob(user: ItemUser, jobId: string) {
  const job = await db.serviceJob.findUnique({ where: { id: jobId } });
  // 404, not 403: a worker should not learn that someone else's job exists.
  if (!job || (user.role === "WORKER" && job.assignedWorkerId !== user.id)) throw notFound("SERVICE_NOT_FOUND", "Service job not found");
  await assertNotPaid(jobId);
  if (user.role === "WORKER") {
    if (isTerminal(job.status)) throw conflict("SERVICE_CLOSED", "This service job is already closed");
    const open = await db.payment.findFirst({ where: { serviceJobId: jobId, status: { in: ["PENDING", "PROCESSING"] } } });
    if (open) throw conflict("PAYMENT_PENDING", "A payment link is already with the customer. Ask reception to change the bill.");
  }
  return job;
}

/** Keeps a worker's change on the invoice, and tells the customer the new total. */
async function afterBillChange(
  user: ItemUser,
  actor: Actor,
  jobId: string,
  step: "ITEM_ADDED" | "ITEM_UPDATED" | "ITEM_REMOVED",
  item: { name: string; total: unknown },
  notifyCustomer?: boolean,
) {
  const worker = user.role === "WORKER";
  const items = await db.serviceItem.findMany({ where: { serviceJobId: jobId }, select: { total: true } });
  if (worker && items.length > 0 && (await db.invoice.findUnique({ where: { serviceJobId: jobId } }))) await generateInvoice(actor, jobId);
  if (!worker && !notifyCustomer) return;
  const paise = items.reduce((sum, i) => sum + toPaise(toNumber(i.total)), 0);
  await NotificationService.sendBillChange(await loadJobContext(jobId), step, { name: item.name, cost: item.total }, fromPaise(paise));
}

export async function addItem(user: ItemUser, actor: Actor, jobId: string, input: ItemInput) {
  const job = await editableJob(user, jobId);
  const { notifyCustomer, ...fields } = input;
  const data = user.role === "WORKER" ? { ...fields, tax: 0, discount: 0 } : fields;
  const item = await db.serviceItem.create({ data: { ...data, serviceJobId: jobId, total: lineTotal(data) } });
  await logActivity(actor, {
    action: "SERVICE_ITEM_ADDED",
    entityType: "ServiceJob",
    entityId: jobId,
    summary: `${actor.name} added ${item.name} to ${job.serviceNumber}`,
  });
  await afterBillChange(user, actor, jobId, "ITEM_ADDED", item, notifyCustomer);
  return item;
}

export async function updateItem(user: ItemUser, actor: Actor, jobId: string, itemId: string, input: ItemInput) {
  const job = await editableJob(user, jobId);
  const existing = await db.serviceItem.findFirst({ where: { id: itemId, serviceJobId: jobId } });
  if (!existing) throw notFound("ITEM_NOT_FOUND", "Item not found");
  const { notifyCustomer, ...fields } = input;
  // Tax and discount are staff decisions, so a worker's edit keeps what is already there.
  const data = user.role === "WORKER" ? { ...fields, tax: toNumber(existing.tax), discount: toNumber(existing.discount) } : fields;
  const item = await db.serviceItem.update({ where: { id: itemId }, data: { ...data, total: lineTotal(data) } });
  await logActivity(actor, {
    action: "SERVICE_ITEM_UPDATED",
    entityType: "ServiceJob",
    entityId: jobId,
    summary: `${actor.name} updated ${item.name} on ${job.serviceNumber}`,
    metadata: { name: existing.name, from: existing.total.toString(), to: item.total.toString() },
  });
  await afterBillChange(user, actor, jobId, "ITEM_UPDATED", item, notifyCustomer);
  return item;
}

export async function removeItem(user: ItemUser, actor: Actor, jobId: string, itemId: string, notifyCustomer?: boolean) {
  await editableJob(user, jobId);
  const item = await db.serviceItem.findFirst({ where: { id: itemId, serviceJobId: jobId } });
  if (!item) throw notFound("ITEM_NOT_FOUND", "Item not found");
  await db.serviceItem.delete({ where: { id: itemId } });
  await logActivity(actor, {
    action: "SERVICE_ITEM_REMOVED",
    entityType: "ServiceJob",
    entityId: jobId,
    summary: `${actor.name} removed ${item.name}`,
  });
  await afterBillChange(user, actor, jobId, "ITEM_REMOVED", item, notifyCustomer);
}

/** Creates the invoice from the job's items, or rebuilds it if the bill changed before payment. */
export async function generateInvoice(actor: Actor, jobId: string) {
  const job = await db.serviceJob.findUnique({
    where: { id: jobId },
    include: { items: true, invoice: true },
  });
  if (!job) throw notFound("SERVICE_NOT_FOUND", "Service job not found");
  if (job.items.length === 0) throw conflict("NO_SERVICE_ITEMS", "Add service items before generating an invoice");
  await assertNotPaid(jobId);

  let labour = 0, parts = 0, tax = 0, discount = 0, total = 0;
  for (const item of job.items) {
    const gross = Math.round(toNumber(item.quantity) * toPaise(toNumber(item.unitPrice)));
    if (item.itemType === "PART") parts += gross;
    else labour += gross;
    tax += toPaise(toNumber(item.tax));
    discount += toPaise(toNumber(item.discount));
    total += toPaise(toNumber(item.total));
  }

  const figures = {
    labourTotal: fromPaise(labour),
    partsTotal: fromPaise(parts),
    subtotal: fromPaise(labour + parts),
    tax: fromPaise(tax),
    discount: fromPaise(discount),
    total: fromPaise(total),
  };
  const lines = job.items.map((i) => ({
    itemType: i.itemType,
    name: i.name,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    tax: i.tax,
    discount: i.discount,
    total: i.total,
  }));

  try {
    const invoice = await db.$transaction(async (tx) => {
      const saved = await tx.invoice.upsert({
        where: { serviceJobId: jobId },
        create: {
          ...figures,
          invoiceNumber: await nextInvoiceNumber(tx),
          serviceJobId: jobId,
          items: { create: lines },
        },
        update: { ...figures, items: { deleteMany: {}, create: lines } },
      });
      await tx.serviceJob.update({ where: { id: jobId }, data: { finalAmount: figures.total } });
      await logActivity(
        actor,
        {
          action: job.invoice ? "INVOICE_UPDATED" : "INVOICE_GENERATED",
          entityType: "Invoice",
          entityId: saved.id,
          summary: `${actor.name} ${job.invoice ? "updated" : "generated"} invoice ${saved.invoiceNumber} for ${job.serviceNumber}`,
        },
        tx,
      );
      return saved;
    });
    return invoice;
  } catch (err) {
    if (isUniqueViolation(err)) return db.invoice.findUniqueOrThrow({ where: { serviceJobId: jobId } });
    throw err;
  }
}

/** Used when a job becomes ready. Keeps an existing paid invoice, and skips jobs with no items. */
export async function generateInvoiceIfNeeded(actor: Actor, jobId: string) {
  const job = await db.serviceJob.findUnique({
    where: { id: jobId },
    include: { invoice: true, _count: { select: { items: true } }, payments: { where: { status: "PAID" }, take: 1 } },
  });
  if (!job) return null;
  if (job.invoice && job.payments.length > 0) return job.invoice;
  if (job._count.items === 0) return job.invoice;
  return generateInvoice(actor, jobId);
}

export const invoiceInclude = {
  items: true,
  serviceJob: {
    include: {
      customer: true,
      vehicle: true,
      payments: { orderBy: { createdAt: "desc" as const } },
    },
  },
} satisfies Prisma.InvoiceInclude;

export type InvoiceFull = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

/** The figure customers see: PAID if any payment is, otherwise the newest payment's status. */
export const invoicePaymentStatus = (invoice: InvoiceFull) =>
  invoice.serviceJob.payments.find((p) => p.status === "PAID")?.status ??
  invoice.serviceJob.payments[0]?.status ??
  "UNPAID";
