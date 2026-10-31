import PDFDocument from "pdfkit";
import { date, toNumber } from "@/lib/format";
import type { InvoiceFull } from "@/lib/services/invoices";

// Built-in PDF fonts have no rupee glyph, so amounts use "Rs."; a TTF would be needed for the symbol.
const rs = (v: unknown) =>
  `Rs. ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toNumber(v as number))}`;

const COLUMNS = { name: 50, qty: 290, price: 340, tax: 420, total: 480 };

export function renderInvoicePdf(invoice: InvoiceFull, paymentStatus: string, centerName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const job = invoice.serviceJob;
    doc.font("Helvetica-Bold").fontSize(20).text(centerName);
    doc.font("Helvetica").fontSize(10).fillColor("#555555").text("Tax invoice").moveDown();

    doc.fillColor("#000000").fontSize(10);
    doc.text(`Invoice: ${invoice.invoiceNumber}`);
    doc.text(`Date: ${date(invoice.invoiceDate)}`);
    doc.text(`Service: ${job.serviceNumber}`);
    doc.text(`Payment status: ${paymentStatus}`).moveDown();
    doc.text(`Customer: ${job.customer.name} (+${job.customer.phone})`);
    doc.text(`Vehicle: ${job.vehicle.brand} ${job.vehicle.model} - ${job.vehicle.registrationNumber}`).moveDown();

    const row = (y: number, values: [string, string, string, string, string]) => {
      doc.text(values[0], COLUMNS.name, y, { width: 230 });
      doc.text(values[1], COLUMNS.qty, y, { width: 45, align: "right" });
      doc.text(values[2], COLUMNS.price, y, { width: 75, align: "right" });
      doc.text(values[3], COLUMNS.tax, y, { width: 55, align: "right" });
      doc.text(values[4], COLUMNS.total, y, { width: 65, align: "right" });
    };

    let y = doc.y;
    doc.font("Helvetica-Bold");
    row(y, ["Item", "Qty", "Price", "Tax", "Total"]);
    y += 18;
    doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor("#cccccc").stroke();
    doc.font("Helvetica");
    for (const item of invoice.items) {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      row(y, [
        `${item.name} (${item.itemType.toLowerCase()})`,
        String(toNumber(item.quantity)),
        rs(item.unitPrice),
        rs(item.tax),
        rs(item.total),
      ]);
      y = Math.max(doc.y, y + 16) + 2;
    }

    y += 12;
    const summary: [string, unknown, boolean?][] = [
      ["Labour", invoice.labourTotal],
      ["Parts", invoice.partsTotal],
      ["Subtotal", invoice.subtotal],
      ["Tax", invoice.tax],
      ["Discount", invoice.discount],
      ["Total", invoice.total, true],
    ];
    for (const [label, value, bold] of summary) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      doc.text(label, 380, y, { width: 80 });
      doc.text(rs(value), 460, y, { width: 85, align: "right" });
      y += 16;
    }
    doc.end();
  });
}
