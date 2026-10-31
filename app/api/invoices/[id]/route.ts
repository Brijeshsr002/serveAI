import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { STAFF } from "@/lib/permissions";
import { invoiceInclude, invoicePaymentStatus } from "@/lib/services/invoices";

export const GET = authed(STAFF, async ({ params }) => {
  const invoice = await db.invoice.findUnique({ where: { id: params.id }, include: invoiceInclude });
  if (!invoice) throw notFound("INVOICE_NOT_FOUND", "Invoice not found");
  return { ...invoice, paymentStatus: invoicePaymentStatus(invoice) };
});
