import { ItemType, Prisma } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import { db, isUniqueViolation, nextInvoiceNumber } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { toNumber } from "@/lib/format";

const amount = z.coerce.number().min(0).max(100_000_000);

export const itemSchema = z.object({
  itemType: z.enum(ItemType),
  name: z.string().trim().min(1, "Name is required").max(160),
  description: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
  quantity: z.coerce.number().positive("Quantity must be above zero").max(100_000).default(1),
  unitPrice: amount,
  tax: amount.default(0),
  discount: amount.default(0),
});

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

export async function addItem(actor: Actor, jobId: string, input: z.output<typeof itemSchema>) {
  const job = await db.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) throw notFound("SERVICE_NOT_FOUND", "Service job not found");
  await assertNotPaid(jobId);
  const item = await db.serviceItem.create({ data: { ...input, serviceJobId: jobId, total: lineTotal(input) } });
  await logActivity(actor, {
    action: "SERVICE_ITEM_ADDED",
    entityType: "ServiceJob",
    entityId: jobId,
    summary: `${actor.name} added ${item.name} to ${job.serviceNumber}`,
  });
  return item;
}

export async function removeItem(actor: Actor, jobId: string, itemId: string) {
  const item = await db.serviceItem.findFirst({ where: { id: itemId, serviceJobId: jobId } });
  if (!item) throw notFound("ITEM_NOT_FOUND", "Item not found");
  await assertNotPaid(jobId);
  await db.serviceItem.delete({ where: { id: itemId } });
  await logActivity(actor, {
    action: "SERVICE_ITEM_REMOVED",
    entityType: "ServiceJob",
    entityId: jobId,
    summary: `${actor.name} removed ${item.name}`,
  });
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
