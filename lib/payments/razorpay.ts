import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/errors";
import type { PaymentEvent, PaymentProvider } from "./types";

const baseUrl = () => (process.env.RAZORPAY_BASE_URL ?? "https://api.razorpay.com").replace(/\/$/, "");

function authHeader() {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  return `Basic ${auth}`;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string } }) | null;
  if (!res.ok || !json) {
    console.error(`Razorpay ${path} failed: ${res.status} ${json?.error?.code ?? ""}`);
    throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "The payment provider rejected the request");
  }
  return json;
}

export const razorpay: PaymentProvider = {
  name: "razorpay",

  isConfigured: () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),

  async createPaymentLink(input) {
    const link = await call<{ id: string; short_url: string }>("/v1/payment_links", {
      amount: input.amountPaise,
      currency: input.currency,
      description: input.description,
      reference_id: input.reference,
      customer: {
        name: input.customer.name,
        contact: `+${input.customer.phone}`,
        ...(input.customer.email ? { email: input.customer.email } : {}),
      },
      // ServeAI sends its own WhatsApp message, so Razorpay's SMS/email are off.
      notify: { sms: false, email: false },
      callback_url: input.callbackUrl,
      callback_method: "get",
    });
    return { orderId: link.id, url: link.short_url };
  },

  async cancelPaymentLink(orderId) {
    await call(`/v1/payment_links/${encodeURIComponent(orderId)}/cancel`);
  },

  matchesWebhook: (headers) => Boolean(headers.get("x-razorpay-signature")),

  verifyWebhook(rawBody, headers) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = headers.get("x-razorpay-signature");
    if (!secret || !signature) return false;
    const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  },

  parseWebhook(rawBody, headers) {
    const body = JSON.parse(rawBody);
    const rawType: string = body.event ?? "unknown";
    const eventId = headers.get("x-razorpay-event-id") ?? createHash("sha256").update(rawBody).digest("hex");
    const link = body.payload?.payment_link?.entity;
    const payment = body.payload?.payment?.entity;
    const refund = body.payload?.refund?.entity;

    const base: PaymentEvent = { eventId, type: "IGNORED", rawType };
    switch (rawType) {
      case "payment_link.paid":
        return { ...base, type: "PAID", orderId: link?.id, paymentId: payment?.id, amountPaise: link?.amount_paid };
      case "payment_link.cancelled":
      case "payment_link.expired":
        return { ...base, type: "CANCELLED", orderId: link?.id };
      case "refund.processed":
        return { ...base, type: "REFUNDED", paymentId: refund?.payment_id };
      default:
        return base;
    }
  },
};
