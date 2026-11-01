import PDFDocument from "pdfkit";
import { date, toNumber } from "@/lib/format";
import type { InvoiceFull } from "@/lib/services/invoices";
import { INVOICE_BACKGROUND } from "./car-images";
import { INTER_BOLD, INTER_REGULAR } from "./fonts";

const BACKGROUND = Buffer.from(INVOICE_BACKGROUND, "base64");
const ROOFLINE = "M7 20c6 0 8-9 17-9s11 7 17 9";

// Inter's Latin subset has no rupee glyph, so amounts use "Rs.".
const rs = (v: unknown) =>
  `Rs. ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toNumber(v as number))}`;

const LEFT = 50;
const RIGHT = 545;
const WIDTH = RIGHT - LEFT;
const FOOTER_Y = 782;
const COLUMNS = { item: LEFT, qty: 290, rate: 335, tax: 415, amount: 470 };

const INK = "#0B1033";
const MUTED = "#6B7280";
const LINE = "#E5E7EB";
const ACCENT = "#4A2BE8";
const STATUS_COLOR: Record<string, string> = { PAID: "#15803D", FAILED: "#B91C1C", REFUNDED: "#6D28D9", CANCELLED: "#475569" };

export type InvoiceCenter = { name: string; phone?: string; address?: string };

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function renderInvoicePdf(invoice: InvoiceFull, paymentStatus: string, center: InvoiceCenter): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    doc.registerFont("Regular", Buffer.from(INTER_REGULAR, "base64"));
    doc.registerFont("Bold", Buffer.from(INTER_BOLD, "base64"));
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const job = invoice.serviceJob;
    const rule = (y: number, color = LINE, width = 0.75) => doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(width).strokeColor(color).stroke();
    const label = (text: string, x: number, y: number, width: number, align: "left" | "right" = "left") =>
      doc.fillColor(MUTED).font("Bold").fontSize(7.5).text(text.toUpperCase(), x, y, { width, align, characterSpacing: 0.6, lineBreak: false });

    // The car sits pale behind the page, on every page, so everything stays readable over it.
    const drawBackground = () => doc.image(BACKGROUND, 0, 0, { width: 595.28, height: 841.89 });
    drawBackground();
    doc.on("pageAdded", drawBackground);

    // Letterhead
    doc.save().translate(LEFT, 46).scale(0.9);
    doc.roundedRect(0, 0, 48, 48, 9).fill(ACCENT);
    doc.path(ROOFLINE).lineWidth(2.6).lineCap("round").stroke("#FFFFFF");
    doc.fillColor("#FFFFFF").font("Bold").fontSize(18).text("CS", 0, 21, { width: 48, align: "center", lineBreak: false });
    doc.restore();
    doc.fillColor(INK).font("Bold").fontSize(17).text(center.name, LEFT + 54, 46, { width: 240, height: 22, ellipsis: true });
    doc.fillColor(MUTED).font("Regular").fontSize(8.5);
    const contact = [center.address, center.phone].filter(Boolean).join("  ·  ");
    doc.text(contact || "Premium car care", LEFT + 54, 70, { width: 240, height: 24, ellipsis: true });

    doc.fillColor(INK).font("Bold").fontSize(22).text("Invoice", 345, 44, { width: RIGHT - 345, align: "right" });
    doc.fillColor(MUTED).font("Regular").fontSize(9).text(invoice.invoiceNumber, 345, 74, { width: RIGHT - 345, align: "right" });
    rule(112, INK, 1);

    // Parties and details
    const blockY = 128;
    label("Billed to", LEFT, blockY, 170);
    doc.fillColor(INK).font("Bold").fontSize(10.5).text(job.customer.name, LEFT, blockY + 14, { width: 170, height: 15, ellipsis: true });
    doc.fillColor(MUTED).font("Regular").fontSize(9).text(`+${job.customer.phone}`, LEFT, blockY + 30, { width: 170 });

    label("Vehicle", 235, blockY, 160);
    doc.fillColor(INK).font("Bold").fontSize(10.5).text(`${job.vehicle.brand} ${job.vehicle.model}`, 235, blockY + 14, { width: 160, height: 15, ellipsis: true });
    doc.fillColor(MUTED).font("Regular").fontSize(9).text(job.vehicle.registrationNumber, 235, blockY + 30, { width: 160 });

    const details: [string, string, string?][] = [
      ["Date", date(invoice.invoiceDate)],
      ["Service", job.serviceNumber],
      ["Status", titleCase(paymentStatus), STATUS_COLOR[paymentStatus] ?? "#B45309"],
    ];
    details.forEach(([name, value, color], i) => {
      const y = blockY + i * 15;
      doc.fillColor(MUTED).font("Regular").fontSize(9).text(name, 410, y, { width: 40 });
      doc.fillColor(color ?? INK).font("Bold").fontSize(9).text(value, 450, y, { width: RIGHT - 450, align: "right" });
    });

    // Line items
    const tableHeader = (top: number) => {
      label("Description", COLUMNS.item, top, 230);
      label("Qty", COLUMNS.qty, top, 35, "right");
      label("Rate", COLUMNS.rate, top, 70, "right");
      label("Tax", COLUMNS.tax, top, 50, "right");
      label("Amount", COLUMNS.amount, top, RIGHT - COLUMNS.amount, "right");
      rule(top + 15, INK, 1);
      return top + 15;
    };

    let y = tableHeader(198);
    for (const item of invoice.items) {
      doc.font("Bold").fontSize(9.5);
      const nameHeight = doc.heightOfString(item.name, { width: 228 });
      const height = nameHeight + 25;
      if (y + height > FOOTER_Y - 30) {
        doc.addPage();
        y = tableHeader(50);
      }
      doc.fillColor(INK).font("Bold").fontSize(9.5).text(item.name, COLUMNS.item, y + 8, { width: 228 });
      doc.fillColor(MUTED).font("Regular").fontSize(8).text(titleCase(item.itemType), COLUMNS.item, y + 10 + nameHeight, { width: 228 });
      doc.fillColor(INK).font("Regular").fontSize(9);
      doc.text(String(toNumber(item.quantity)), COLUMNS.qty, y + 8, { width: 35, align: "right" });
      doc.text(rs(item.unitPrice), COLUMNS.rate, y + 8, { width: 70, align: "right" });
      doc.text(rs(item.tax), COLUMNS.tax, y + 8, { width: 50, align: "right" });
      doc.font("Bold").text(rs(item.total), COLUMNS.amount, y + 8, { width: RIGHT - COLUMNS.amount, align: "right" });
      y += height;
      rule(y);
    }

    // Totals
    const summary: [string, unknown][] = [
      ["Labour", invoice.labourTotal],
      ["Parts", invoice.partsTotal],
      ["Subtotal", invoice.subtotal],
      ["Tax", invoice.tax],
      ...(toNumber(invoice.discount) > 0 ? ([["Discount", invoice.discount]] as [string, unknown][]) : []),
    ];
    if (y + summary.length * 17 + 60 > FOOTER_Y - 10) {
      doc.addPage();
      y = 40;
    }
    y += 14;
    const totalsX = 345;
    for (const [name, value] of summary) {
      doc.fillColor(MUTED).font("Regular").fontSize(9).text(name, totalsX, y, { width: 90 });
      doc.fillColor(INK).font("Regular").fontSize(9).text(`${name === "Discount" ? "- " : ""}${rs(value)}`, totalsX + 90, y, { width: RIGHT - totalsX - 90, align: "right" });
      y += 17;
    }
    y += 2;
    doc.moveTo(totalsX, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(INK).stroke();
    y += 10;
    const paid = paymentStatus === "PAID";
    doc.fillColor(INK).font("Bold").fontSize(11).text(paid ? "Total paid" : "Total due", totalsX, y + 1, { width: 80 });
    doc.fillColor(ACCENT).font("Bold").fontSize(14).text(rs(invoice.total), totalsX + 70, y, { width: RIGHT - totalsX - 70, align: "right" });

    // Footer on every page
    const { start, count } = doc.bufferedPageRange();
    for (let page = start; page < start + count; page++) {
      doc.switchToPage(page);
      rule(FOOTER_Y - 10);
      doc.fillColor(MUTED).font("Regular").fontSize(8).text(`Thank you for choosing ${center.name}.`, LEFT, FOOTER_Y, { width: WIDTH / 2, lineBreak: false });
      doc.text(count > 1 ? `Page ${page - start + 1} of ${count}  ·  Powered by ServAI` : "Powered by ServAI", LEFT + WIDTH / 2, FOOTER_Y, { width: WIDTH / 2, align: "right", lineBreak: false });
    }
    doc.end();
  });
}
