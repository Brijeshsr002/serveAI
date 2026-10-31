import { authed, ok } from "@/lib/api/route";
import { db } from "@/lib/db";
import { STAFF } from "@/lib/permissions";
import { createCustomer, customerSchema, customerSearchWhere } from "@/lib/services/customers";

export const GET = authed(STAFF, async ({ req }) => {
  const q = req.nextUrl.searchParams.get("q");
  return db.customer.findMany({
    where: customerSearchWhere(q),
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { vehicles: true },
  });
});

export const POST = authed(STAFF, async ({ actor, body }) => ok(await createCustomer(actor, await body(customerSchema)), 201));
