import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { getSettings } from "@/lib/settings";

const TOKEN_RE = /^[a-f0-9]{64}$/;

export async function jobByToken(token: string) {
  if (!TOKEN_RE.test(token)) throw notFound("TRACKING_NOT_FOUND", "We couldn't find this service");
  const job = await db.serviceJob.findUnique({
    where: { trackingToken: token },
    include: {
      customer: true,
      vehicle: true,
      invoice: true,
      items: { orderBy: { createdAt: "asc" } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!job) throw notFound("TRACKING_NOT_FOUND", "We couldn't find this service");
  return job;
}

/**
 * Everything a public tracking link may reveal. Built field by field, on purpose: database ids,
 * internal notes, worker details and who changed a status never leave this function.
 */
export async function publicTrackingView(token: string) {
  const job = await jobByToken(token);
  const settings = await getSettings();
  const paid = job.payments.find((p) => p.status === "PAID");
  const latest = job.payments[0];
  return {
    serviceNumber: job.serviceNumber,
    customerName: job.customer.name,
    vehicle: {
      brand: job.vehicle.brand,
      model: job.vehicle.model,
      registrationNumber: job.vehicle.registrationNumber,
    },
    serviceType: job.serviceType,
    status: job.status,
    serviceCenter: { name: settings.center_name, phone: settings.center_phone, address: settings.center_address },
    timeline: job.statusHistory.map((h) => ({ status: h.newStatus, at: h.createdAt.toISOString() })),
    estimatedAmount: job.estimatedAmount?.toString() ?? null,
    finalAmount: (job.invoice?.total ?? job.finalAmount)?.toString() ?? null,
    items: job.items.map((i) => ({ name: i.name, quantity: i.quantity.toString(), total: i.total.toString() })),
    billSoFar: (job.items.reduce((sum, i) => sum + Math.round(Number(i.total) * 100), 0) / 100).toString(),
    paymentStatus: paid ? "PAID" : (latest?.status ?? "UNPAID"),
    paidAt: paid?.paidAt?.toISOString() ?? null,
    hasInvoice: Boolean(job.invoice),
    invoiceNumber: job.invoice?.invoiceNumber ?? null,
    completedAt: job.actualCompletion?.toISOString() ?? null,
  };
}

export type PublicTrackingView = Awaited<ReturnType<typeof publicTrackingView>>;
