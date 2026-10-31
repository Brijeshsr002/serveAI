import { Prisma } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import { db, isUniqueViolation, nextCustomerCode } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { normalizePhone, normalizeRegistration, requirePhone } from "@/lib/phone";

const optionalText = z.string().trim().max(500).optional().nullable().transform((v) => v || null);

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().min(5, "Phone is required"),
  email: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional().transform((v) => v || null),
  address: optionalText,
  city: optionalText,
  notes: z.string().trim().max(5000).optional().nullable().transform((v) => v || null),
});

export const customerPatchSchema = customerSchema.partial();

export async function createCustomer(actor: Actor, input: z.output<typeof customerSchema>) {
  const phone = requirePhone(input.phone);
  try {
    const customer = await db.customer.create({
      data: { ...input, phone, customerCode: await nextCustomerCode() },
    });
    await logActivity(actor, {
      action: "CUSTOMER_CREATED",
      entityType: "Customer",
      entityId: customer.id,
      summary: `${actor.name} created customer ${customer.customerCode} (${customer.name})`,
    });
    return customer;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("DUPLICATE_PHONE", "A customer with this phone number already exists");
    throw err;
  }
}

export async function updateCustomer(actor: Actor, id: string, input: z.output<typeof customerPatchSchema>) {
  const data: Prisma.CustomerUpdateInput = { ...input };
  if (input.phone !== undefined) data.phone = requirePhone(input.phone);
  try {
    const customer = await db.customer.update({ where: { id }, data });
    await logActivity(actor, {
      action: "CUSTOMER_UPDATED",
      entityType: "Customer",
      entityId: id,
      summary: `${actor.name} updated customer ${customer.customerCode}`,
    });
    return customer;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("DUPLICATE_PHONE", "Another customer already has this phone number");
    throw err;
  }
}

export async function deleteCustomer(actor: Actor, id: string) {
  const customer = await db.customer.findUnique({
    where: { id },
    include: { _count: { select: { serviceJobs: true, payments: true } } },
  });
  if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  if (customer._count.serviceJobs > 0 || customer._count.payments > 0) {
    throw conflict("CUSTOMER_HAS_HISTORY", "This customer has service or payment history and cannot be deleted");
  }
  await db.$transaction(async (tx) => {
    await tx.vehicle.deleteMany({ where: { customerId: id } });
    await tx.customer.delete({ where: { id } });
    await logActivity(
      actor,
      {
        action: "CUSTOMER_DELETED",
        entityType: "Customer",
        entityId: id,
        summary: `${actor.name} deleted customer ${customer.customerCode} (${customer.name})`,
      },
      tx,
    );
  });
}

/** Safe under concurrent webhooks: the unique phone index decides the winner, the loser re-reads. */
export async function findOrCreateCustomerByPhone(phone: string, name?: string | null, bsuid?: string | null) {
  const existing = await db.customer.findUnique({ where: { phone } });
  if (existing) {
    if ((bsuid && existing.bsuid !== bsuid) || (name && existing.name === existing.phone)) {
      return db.customer.update({
        where: { id: existing.id },
        data: {
          bsuid: bsuid ?? existing.bsuid,
          name: name && existing.name === existing.phone ? name : existing.name,
        },
      });
    }
    return existing;
  }
  try {
    return await db.customer.create({
      data: { phone, bsuid: bsuid ?? null, name: name?.trim() || phone, customerCode: await nextCustomerCode() },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return db.customer.findUniqueOrThrow({ where: { phone } });
    throw err;
  }
}

/** Search across name, phone, customer code and vehicle registration. */
export function customerSearchWhere(q: string | null | undefined): Prisma.CustomerWhereInput {
  const term = q?.trim();
  if (!term) return {};
  const reg = normalizeRegistration(term);
  const phoneDigits = term.replace(/\D/g, "");
  return {
    OR: [
      { name: { contains: term, mode: "insensitive" } },
      { customerCode: { contains: term, mode: "insensitive" } },
      ...(phoneDigits.length >= 3 ? [{ phone: { contains: normalizePhone(phoneDigits) ?? phoneDigits } }] : []),
      ...(reg ? [{ vehicles: { some: { registrationNumber: { contains: reg } } } }] : []),
    ],
  };
}
