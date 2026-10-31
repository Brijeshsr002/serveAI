import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { STAFF } from "@/lib/permissions";
import { normalizeRegistration } from "@/lib/phone";
import { customerSearchWhere } from "@/lib/services/customers";

export const GET = authed(STAFF, async ({ req }) => {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return { customers: [], vehicles: [], jobs: [], invoices: [] };
  const reg = normalizeRegistration(q);
  const [customers, vehicles, jobs, invoices] = await Promise.all([
    db.customer.findMany({ where: customerSearchWhere(q), take: 5, select: { id: true, name: true, phone: true, customerCode: true } }),
    db.vehicle.findMany({ where: { registrationNumber: { contains: reg || "__none__" } }, take: 5, select: { id: true, registrationNumber: true, brand: true, model: true } }),
    db.serviceJob.findMany({
      where: {
        OR: [
          { serviceNumber: { contains: q, mode: "insensitive" } },
          { vehicle: { registrationNumber: { contains: reg || "__none__" } } },
        ],
      },
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { id: true, serviceNumber: true, status: true, serviceType: true, payments: { take: 1, orderBy: { createdAt: "desc" }, select: { status: true } } },
    }),
    db.invoice.findMany({ where: { invoiceNumber: { contains: q, mode: "insensitive" } }, take: 5, select: { id: true, invoiceNumber: true, total: true } }),
  ]);
  return { customers, vehicles, jobs, invoices };
});
