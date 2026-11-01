import PDFDocument from "pdfkit";
import { date, toNumber } from "@/lib/format";
import type { InvoiceFull } from "@/lib/services/invoices";
import { INVOICE_BACKGROUND } from "./car-images";
import { INTER_BOLD, INTER_REGULAR, INTER_RUPEE_BOLD, INTER_RUPEE_REGULAR } from "./fonts";

const BACKGROUND = Buffer.from(INVOICE_BACKGROUND, "base64");
const ROOFLINE = "M7 20c6 0 8-9 17-9s11 7 17 9";

const figure = (v: unknown) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toNumber(v as number));

// Drawn on a 24-unit grid.
const ICON_PHONE = ["M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"];
const ICON_MAIL = ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M22 6l-10 7L2 6"];
const ICON_PIN = ["M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z", "M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"];

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

export type InvoiceCenter = { name: string; phone?: string; address?: string; email?: string };

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function renderInvoicePdf(invoice: InvoiceFull, paymentStatus: string, center: InvoiceCenter): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    doc.registerFont("Regular", Buffer.from(INTER_REGULAR, "base64"));
    doc.registerFont("Bold", Buffer.from(INTER_BOLD, "base64"));
    doc.registerFont("RupeeRegular", Buffer.from(INTER_RUPEE_REGULAR, "base64"));
    doc.registerFont("RupeeBold", Buffer.from(INTER_RUPEE_BOLD, "base64"));
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const job = invoice.serviceJob;
    const rule = (y: number, color = LINE, width = 0.75) => doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(width).strokeColor(color).stroke();
    const label = (text: string, x: number, y: number, width: number, align: "left" | "right" = "left") =>
      doc.fillColor(MUTED).font("Bold").fontSize(7.5).text(text.toUpperCase(), x, y, { width, align, characterSpacing: 0.6, lineBreak: false });

    // The rupee sign comes from Inter's latin-ext subset and the digits from its latin one. Same design and metrics, so they sit as one figure, right-aligned.
    const amount = (value: unknown, x: number, y: number, width: number, { font = "Regular", size = 9, color = INK, prefix = "" }: { font?: "Regular" | "Bold"; size?: number; color?: string; prefix?: string } = {}) => {
      const digits = figure(value);
      const digitsWidth = doc.font(font).fontSize(size).widthOfString(digits);
      const signWidth = doc.font(`Rupee${font}`).fontSize(size).widthOfString("₹");
      const prefixWidth = prefix ? doc.font(font).fontSize(size).widthOfString(prefix) : 0;
      const start = x + width - digitsWidth - signWidth - prefixWidth;
      doc.fillColor(color);
      if (prefix) doc.font(font).fontSize(size).text(prefix, start, y, { lineBreak: false });
      doc.font(`Rupee${font}`).fontSize(size).text("₹", start + prefixWidth, y, { lineBreak: false });
      doc.font(font).fontSize(size).text(digits, start + prefixWidth + signWidth, y, { lineBreak: false });
    };

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
    // A blank contact field just doesn't show, and the rows close up.
    const contacts: [string[], string][] = [[ICON_PHONE, center.phone], [ICON_MAIL, center.email], [ICON_PIN, center.address]]
      .flatMap(([icon, text]) => (typeof text === "string" && text.trim() ? [[icon, text.trim()] as [string[], string]] : []));
    let contactY = 69;
    for (const [icon, text] of contacts) {
      doc.save().translate(LEFT + 54, contactY + 1).scale(8 / 24);
      icon.forEach((d) => doc.path(d));
      doc.lineWidth(2).lineCap("round").lineJoin("round").strokeColor(ACCENT).stroke();
      doc.restore();
      doc.fillColor(MUTED).font("Regular").fontSize(8.5);
      // Only the address can run to a second line, and it's last, so the rows stay above the rule.
      const height = Math.min(doc.heightOfString(text, { width: 226 }), 22);
      doc.text(text, LEFT + 66, contactY, { width: 226, height, ellipsis: true });
      contactY += height + 0.5;
    }

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
      amount(item.unitPrice, COLUMNS.rate, y + 8, 70);
      amount(item.tax, COLUMNS.tax, y + 8, 50);
      amount(item.total, COLUMNS.amount, y + 8, RIGHT - COLUMNS.amount, { font: "Bold" });
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
      amount(value, totalsX + 90, y, RIGHT - totalsX - 90, { prefix: name === "Discount" ? "- " : "" });
      y += 17;
    }
    y += 2;
    doc.moveTo(totalsX, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(INK).stroke();
    y += 10;
    const paid = paymentStatus === "PAID";
    doc.fillColor(INK).font("Bold").fontSize(11).text(paid ? "Total paid" : "Total due", totalsX, y + 1, { width: 80 });
    amount(invoice.total, totalsX + 70, y, RIGHT - totalsX - 70, { font: "Bold", size: 14, color: ACCENT });

    // Footer on every page
    const { start, count } = doc.bufferedPageRange();
    for (let page = start; page < start + count; page++) {
      doc.switchToPage(page);
      rule(FOOTER_Y - 10);
      doc.fillColor(MUTED).font("Regular").fontSize(8).text(`Thank you for choosing ${center.name}.`, LEFT, FOOTER_Y, { width: WIDTH / 2, lineBreak: false });
      const powered = "Powered by ServAI";
      const poweredX = RIGHT - doc.widthOfString(powered);
      doc.text(powered, poweredX, FOOTER_Y, { lineBreak: false });
      // The A from the ServAI logo.
      doc.save().translate(poweredX - 12, FOOTER_Y - 1.2).scale(0.125);
      doc.path("M6 70 L41 13 L76 70").lineWidth(13).lineJoin("round").strokeColor(ACCENT).stroke();
      doc.roundedRect(26, 49, 30, 21, 8).fill(ACCENT);
      doc.restore();
      if (count > 1) {
        doc.fillColor(MUTED).font("Regular").fontSize(8).text(`Page ${page - start + 1} of ${count}`, LEFT + WIDTH / 2, FOOTER_Y, { width: poweredX - 16 - LEFT - WIDTH / 2, align: "right", lineBreak: false });
      }
    }
    doc.end();
  });
}
