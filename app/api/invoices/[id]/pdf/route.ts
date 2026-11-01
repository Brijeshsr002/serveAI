import { NextResponse } from "next/server";
import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { STAFF } from "@/lib/permissions";
import { invoiceInclude, invoicePaymentStatus } from "@/lib/services/invoices";
import { getSettings } from "@/lib/settings";

export const GET = authed(STAFF, async ({ params }) => {
  const invoice = await db.invoice.findUnique({ where: { id: params.id }, include: invoiceInclude });
  if (!invoice) throw notFound("INVOICE_NOT_FOUND", "Invoice not found");
  const { center_name, center_phone, center_address, center_email } = await getSettings();
  const pdf = await renderInvoicePdf(invoice, invoicePaymentStatus(invoice), { name: center_name, phone: center_phone, address: center_address, email: center_email });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
    },
  });
});
