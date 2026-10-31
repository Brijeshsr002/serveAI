import PDFDocument from "pdfkit";
import { date, toNumber } from "@/lib/format";
import type { InvoiceFull } from "@/lib/services/invoices";
import { INVOICE_BACKGROUND, INVOICE_HEADER } from "./car-images";
import { INTER_BOLD, INTER_REGULAR } from "./fonts";

const BACKGROUND = Buffer.from(INVOICE_BACKGROUND, "base64");
const HEADER = Buffer.from(INVOICE_HEADER, "base64");
const ROOFLINE = "M7 20c6 0 8-9 17-9s11 7 17 9";
const PAGE_HEIGHT = 841.89;

// Built-in PDF fonts have no rupee glyph, so amounts use "Rs."; a TTF would be needed for the symbol.
const rs = (v: unknown) =>
  `Rs. ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toNumber(v as number))}`;

const COLUMNS = { name: 58, qty: 290, price: 340, tax: 420, total: 472 };
const PAGE_WIDTH = 595.28;
const ORANGE = "#C2410C";
const INK = "#0F172A";
const MUTED = "#64748B";
const STATUS_COLOR: Record<string, string> = { PAID: "#15803D", FAILED: "#B91C1C", REFUNDED: "#6D28D9", CANCELLED: "#475569" };
const TYPE_COLOR: Record<string, string> = { PART: ORANGE, LABOUR: "#1D4ED8", SERVICE: "#0F766E" };

export type InvoiceCenter = { name: string; phone?: string; address?: string };

export function renderInvoicePdf(invoice: InvoiceFull, paymentStatus: string, center: InvoiceCenter): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.registerFont("Regular", Buffer.from(INTER_REGULAR, "base64"));
    doc.registerFont("Bold", Buffer.from(INTER_BOLD, "base64"));
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const job = invoice.serviceJob;

    // A pale real car behind the page, repeated on any extra pages.
    const drawBackground = () => doc.image(BACKGROUND, 0, PAGE_HEIGHT - 400, { width: PAGE_WIDTH });
    drawBackground();
    doc.on("pageAdded", drawBackground);

    doc.save().rect(0, 0, PAGE_WIDTH, 112).clip().image(HEADER, 0, 0, { width: PAGE_WIDTH, height: 112 }).restore();
    doc.save().opacity(0.5).rect(0, 0, PAGE_WIDTH, 112).fill(INK).restore();
    doc.rect(0, 112, PAGE_WIDTH, 6).fill(ORANGE);
    doc.save().translate(50, 30).scale(1.1);
    doc.roundedRect(0, 0, 48, 48, 11).fill(ORANGE);
    doc.path(ROOFLINE).lineWidth(2.6).lineCap("round").stroke("#FFFFFF");
    doc.fillColor("#FFFFFF").font("Bold").fontSize(18).text("CS", 0, 21, { width: 48, align: "center", lineBreak: false });
    doc.restore();
    doc.fillColor("#FFFFFF").font("Bold").fontSize(24).text(center.name, 116, 30, { width: 260, height: 30, ellipsis: true });
    doc.font("Regular").fontSize(9).fillColor("#FFEDD5").text(`× ${"ServeAI"}`, 116, 61, { width: 260 });
    const contact = [center.address, center.phone].filter(Boolean).join("  |  ");
    if (contact) doc.text(contact, 116, 76, { width: 260, height: 26, ellipsis: true });
    doc.fillColor("#FFFFFF").font("Bold").fontSize(20).text("INVOICE", 380, 28, { width: 165, align: "right" });
    doc.font("Regular").fontSize(10).text(invoice.invoiceNumber, 380, 56, { width: 165, align: "right" });
    doc.text(date(invoice.invoiceDate), 380, 70, { width: 165, align: "right" });

    const card = (x: number, title: string, color: string, tint: string, lines: string[]) => {
      doc.roundedRect(x, 136, 240, 76, 6).fill(tint);
      doc.rect(x, 136, 4, 76).fill(color);
      doc.fillColor(color).font("Bold").fontSize(9).text(title, x + 14, 146, { width: 216 });
      doc.fillColor(INK).font("Bold").fontSize(11).text(lines[0], x + 14, 160, { width: 216, height: 14, ellipsis: true });
      doc.font("Regular").fontSize(9).fillColor(MUTED).text(lines[1], x + 14, 177, { width: 216, height: 26, ellipsis: true });
    };
    card(50, "BILL TO", ORANGE, "#FFF7ED", [job.customer.name, `+${job.customer.phone}`]);
    card(305, "VEHICLE", "#0F766E", "#F0FDFA", [`${job.vehicle.brand} ${job.vehicle.model}`, `${job.vehicle.registrationNumber}  |  Service ${job.serviceNumber}`]);

    const statusLabel = paymentStatus.charAt(0) + paymentStatus.slice(1).toLowerCase();
    doc.roundedRect(50, 224, 120, 20, 10).fill(STATUS_COLOR[paymentStatus] ?? "#B45309");
    doc.fillColor("#FFFFFF").font("Bold").fontSize(9).text(statusLabel, 50, 230, { width: 120, align: "center" });

    const row = (y: number, values: [string, string, string, string]) => {
      doc.text(values[0], COLUMNS.qty, y, { width: 45, align: "right" });
      doc.text(values[1], COLUMNS.price, y, { width: 75, align: "right" });
      doc.text(values[2], COLUMNS.tax, y, { width: 50, align: "right" });
      doc.text(values[3], COLUMNS.total, y, { width: 65, align: "right" });
    };
    const tableHeader = (top: number) => {
      doc.roundedRect(50, top, 495, 22, 4).fill(INK);
      doc.fillColor("#FFFFFF").font("Bold").fontSize(9);
      doc.text("ITEM", COLUMNS.name, top + 7, { width: 225 });
      row(top + 7, ["QTY", "PRICE", "TAX", "TOTAL"]);
      return top + 22;
    };

    let y = tableHeader(256);
    invoice.items.forEach((item, index) => {
      doc.font("Bold").fontSize(10);
      const nameHeight = doc.heightOfString(item.name, { width: 225 });
      const height = nameHeight + 24;
      if (y + height > 740) {
        doc.addPage();
        y = tableHeader(50);
      }
      if (index % 2 === 1) doc.rect(50, y, 495, height).fill("#F8FAFC");
      doc.fillColor(INK).font("Bold").fontSize(10).text(item.name, COLUMNS.name, y + 6, { width: 225 });
      doc.fillColor(TYPE_COLOR[item.itemType] ?? MUTED).font("Bold").fontSize(8).text(item.itemType, COLUMNS.name, y + 8 + nameHeight, { width: 225 });
      doc.fillColor(INK).font("Regular").fontSize(9);
      row(y + 7, [String(toNumber(item.quantity)), rs(item.unitPrice), rs(item.tax), rs(item.total)]);
      y += height;
    });

    if (y + 170 > 790) {
      doc.addPage();
      y = 30;
    }
    y += 16;
    const summary: [string, unknown, string][] = [
      ["Labour", invoice.labourTotal, "#1D4ED8"],
      ["Parts", invoice.partsTotal, ORANGE],
      ["Subtotal", invoice.subtotal, INK],
      ["Tax", invoice.tax, INK],
      ["Discount", invoice.discount, "#15803D"],
    ];
    doc.fontSize(10);
    for (const [label, value, color] of summary) {
      doc.font("Regular").fillColor(MUTED).text(label, 345, y, { width: 90 });
      doc.font("Bold").fillColor(color).text(rs(value), 435, y, { width: 102, align: "right" });
      y += 16;
    }
    y += 4;
    doc.roundedRect(335, y, 210, 32, 6).fill(ORANGE);
    doc.fillColor("#FFFFFF").font("Bold").fontSize(12).text("TOTAL", 347, y + 10, { width: 70 });
    doc.text(rs(invoice.total), 405, y + 10, { width: 130, align: "right" });
    y += 50;

    doc.fillColor(MUTED).font("Regular").fontSize(10).text(`Thank you for choosing ${center.name}.`, 50, y, { width: 495, align: "center" });
    doc.fontSize(8).text("Powered by ServeAI", 50, y + 16, { width: 495, align: "center" });
    doc.end();
  });
}
