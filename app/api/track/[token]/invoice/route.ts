import { NextResponse } from "next/server";
import { open } from "@/lib/api/route";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { invoiceInclude, invoicePaymentStatus } from "@/lib/services/invoices";
import { getSettings } from "@/lib/settings";
import { jobByToken } from "@/lib/services/tracking";

export const GET = open(
  async ({ params }) => {
    const job = await jobByToken(params.token);
    const invoice = await db.invoice.findUnique({ where: { serviceJobId: job.id }, include: invoiceInclude });
    if (!invoice) throw notFound("INVOICE_NOT_FOUND", "The invoice isn't ready yet");
    const { center_name } = await getSettings();
    const pdf = await renderInvoicePdf(invoice, invoicePaymentStatus(invoice), center_name);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
      },
    });
  },
  { limit: { name: "track-invoice", limit: 30, windowMs: 60_000 } },
);
