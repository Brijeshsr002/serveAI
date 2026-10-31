import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { STAFF } from "@/lib/permissions";

export const GET = authed(STAFF, async ({ params }) => {
  const payment = await db.payment.findUnique({
    where: { id: params.id },
    include: { customer: { select: { id: true, name: true } }, serviceJob: { select: { id: true, serviceNumber: true } } },
  });
  if (!payment) throw notFound("PAYMENT_NOT_FOUND", "Payment not found");
  return payment;
});
