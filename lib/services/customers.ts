import { type PaymentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import { db, isUniqueViolation, nextCustomerCode } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { date, dateTime, money, toNumber } from "@/lib/format";
import { normalizePhone, normalizeRegistration, requirePhone } from "@/lib/phone";
import { ACTIVE_STATUSES, TERMINAL } from "@/lib/status";

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

/** Name, phone and vehicle registration: all the top search looks at. */
export function contactSearchWhere(q: string | null | undefined): Prisma.CustomerWhereInput {
  const term = q?.trim();
  if (!term) return {};
  const reg = normalizeRegistration(term);
  const phoneDigits = term.replace(/\D/g, "");
  return {
    OR: [
      { name: { contains: term, mode: "insensitive" } },
      ...(phoneDigits.length >= 3 ? [{ phone: { contains: normalizePhone(phoneDigits) ?? phoneDigits } }] : []),
      ...(reg ? [{ vehicles: { some: { registrationNumber: { contains: reg } } } }] : []),
    ],
  };
}

/** The contact search, plus the customer code and vehicle make and model printed on each card. */
export function customerSearchWhere(q: string | null | undefined): Prisma.CustomerWhereInput {
  const term = q?.trim();
  if (!term) return {};
  return {
    OR: [
      ...(contactSearchWhere(term).OR ?? []),
      { customerCode: { contains: term, mode: "insensitive" } },
      { vehicles: { some: { OR: [{ brand: { contains: term, mode: "insensitive" } }, { model: { contains: term, mode: "insensitive" } }] } } },
    ],
  };
}

/** Everything the view dialog shows, as plain strings, so it's safe to send to the browser. */
export async function customerOverview(id: string) {
  const job = {
    select: {
      id: true, serviceNumber: true, serviceType: true, status: true, appointmentDate: true, createdAt: true, estimatedAmount: true, finalAmount: true,
      vehicle: { select: { registrationNumber: true } },
      assignedWorker: { select: { name: true } },
    },
  } as const;
  const [customer, active, recent, payments, totals] = await Promise.all([
    db.customer.findUnique({ where: { id }, include: { vehicles: { orderBy: { createdAt: "asc" } } } }),
    db.serviceJob.findMany({ ...job, where: { customerId: id, status: { in: ACTIVE_STATUSES } }, orderBy: { createdAt: "desc" } }),
    db.serviceJob.findMany({ ...job, where: { customerId: id, status: { in: TERMINAL } }, orderBy: { updatedAt: "desc" }, take: 5 }),
    db.payment.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 5, include: { serviceJob: { select: { id: true, serviceNumber: true } } } }),
    db.payment.groupBy({ by: ["status"], where: { customerId: id }, _sum: { amount: true } }),
  ]);
  if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  const jobRow = (j: (typeof active)[number]) => ({
    id: j.id,
    serviceNumber: j.serviceNumber,
    serviceType: j.serviceType,
    status: j.status,
    registrationNumber: j.vehicle.registrationNumber,
    workerName: j.assignedWorker?.name ?? null,
    amount: money(j.finalAmount ?? j.estimatedAmount),
    created: date(j.createdAt),
    appointment: j.appointmentDate ? dateTime(j.appointmentDate) : null,
  });
  const sum = (...statuses: PaymentStatus[]) => money(totals.filter((t) => statuses.includes(t.status)).reduce((n, t) => n + toNumber(t._sum.amount), 0));
  return {
    id: customer.id,
    name: customer.name,
    customerCode: customer.customerCode,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    city: customer.city,
    notes: customer.notes,
    vehicles: customer.vehicles.map((v) => ({
      id: v.id,
      registrationNumber: v.registrationNumber,
      name: `${v.brand} ${v.model}`,
      details: [v.manufacturingYear, v.fuelType, v.color].filter(Boolean).join(" · "),
    })),
    activeJobs: active.map(jobRow),
    recentJobs: recent.map(jobRow),
    payment: {
      latestStatus: payments[0]?.status ?? null,
      due: sum("PENDING", "PROCESSING"),
      paid: sum("PAID"),
      rows: payments.map((p) => ({
        id: p.id,
        jobId: p.serviceJob.id,
        serviceNumber: p.serviceJob.serviceNumber,
        amount: money(p.amount),
        status: p.status,
        when: dateTime(p.paidAt ?? p.createdAt),
      })),
    },
  };
}

export type CustomerOverview = Awaited<ReturnType<typeof customerOverview>>;
