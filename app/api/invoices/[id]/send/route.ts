import { logActivity } from "@/lib/activity";
import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { loadJobContext, NotificationService, whatsappFailure } from "@/lib/notifications";
import { STAFF } from "@/lib/permissions";
import { SendieeError } from "@/lib/sendiee";

export const POST = authed(STAFF, async ({ actor, params }) => {
  const invoice = await db.invoice.findUnique({ where: { id: params.id } });
  if (!invoice) throw notFound("INVOICE_NOT_FOUND", "Invoice not found");
  try {
    await NotificationService.sendInvoice(await loadJobContext(invoice.serviceJobId), invoice.invoiceNumber);
  } catch (err) {
    if (err instanceof SendieeError) throw whatsappFailure(err);
    throw err;
  }
  await logActivity(actor, { action: "INVOICE_SENT", entityType: "Invoice", entityId: invoice.id, summary: `${actor.name} sent invoice ${invoice.invoiceNumber} on WhatsApp` });
  return null;
});
