import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { ADMIN_ONLY, STAFF } from "@/lib/permissions";
import { customerPatchSchema, deleteCustomer, updateCustomer } from "@/lib/services/customers";

export const GET = authed(STAFF, async ({ params }) => {
  const customer = await db.customer.findUnique({
    where: { id: params.id },
    include: {
      vehicles: true,
      serviceJobs: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  return customer;
});

export const PATCH = authed(STAFF, async ({ actor, params, body }) =>
  updateCustomer(actor, params.id, await body(customerPatchSchema)),
);

export const DELETE = authed(ADMIN_ONLY, async ({ actor, params }) => {
  await deleteCustomer(actor, params.id);
  return null;
});
