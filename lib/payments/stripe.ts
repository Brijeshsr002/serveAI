import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/errors";
import type { PaymentEvent, PaymentProvider } from "./types";

const baseUrl = () => (process.env.STRIPE_BASE_URL ?? "https://api.stripe.com").replace(/\/$/, "");
const SIGNATURE_TOLERANCE_SECONDS = 300;

async function call<T>(path: string, form?: Record<string, string>): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || !json) {
    console.error(`Stripe ${path} failed: ${res.status}`);
    throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "The payment provider rejected the request");
  }
  return json;
}

export const stripe: PaymentProvider = {
  name: "stripe",

  isConfigured: () => Boolean(process.env.STRIPE_SECRET_KEY),

  async createPaymentLink(input) {
    const session = await call<{ id: string; url: string }>("/v1/checkout/sessions", {
      mode: "payment",
      client_reference_id: input.reference,
      success_url: input.callbackUrl,
      cancel_url: input.callbackUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(input.amountPaise),
      "line_items[0][price_data][product_data][name]": input.description,
    });
    return { orderId: session.id, url: session.url };
  },

  async cancelPaymentLink(orderId) {
    await call(`/v1/checkout/sessions/${encodeURIComponent(orderId)}/expire`);
  },

  matchesWebhook: (headers) => Boolean(headers.get("stripe-signature")),

  verifyWebhook(rawBody, headers) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const header = headers.get("stripe-signature");
    if (!secret || !header) return false;
    const parts = header.split(",").map((p) => p.split("="));
    const timestamp = parts.find(([k]) => k === "t")?.[1];
    const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
    if (!timestamp) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
    const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
    return signatures.some((s) => {
      const given = Buffer.from(s);
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  },

  parseWebhook(rawBody) {
    const body = JSON.parse(rawBody);
    const rawType: string = body.type ?? "unknown";
    const object = body.data?.object;
    const base: PaymentEvent = { eventId: body.id, type: "IGNORED", rawType };
    switch (rawType) {
      case "checkout.session.completed":
        return object?.payment_status === "paid"
          ? { ...base, type: "PAID", orderId: object.id, paymentId: object.payment_intent, amountPaise: object.amount_total }
          : base;
      case "checkout.session.expired":
        return { ...base, type: "CANCELLED", orderId: object?.id };
      case "charge.refunded":
        return { ...base, type: "REFUNDED", paymentId: object?.payment_intent };
      default:
        return base;
    }
  },
};
