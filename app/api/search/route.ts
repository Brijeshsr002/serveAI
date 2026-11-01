import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { STAFF } from "@/lib/permissions";
import { normalizeRegistration } from "@/lib/phone";
import { contactSearchWhere } from "@/lib/services/customers";

/** The search on Customers & Jobs: name, phone and vehicle number only. */
export const GET = authed(STAFF, async ({ req }) => {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return { customers: [], vehicles: [] };
  const reg = normalizeRegistration(q);
  const [customers, vehicles] = await Promise.all([
    db.customer.findMany({ where: contactSearchWhere(q), take: 5, select: { id: true, name: true, phone: true } }),
    reg ? db.vehicle.findMany({ where: { registrationNumber: { contains: reg } }, take: 5, select: { id: true, registrationNumber: true, brand: true, model: true } }) : [],
  ]);
  return { customers, vehicles };
});
