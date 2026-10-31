export type CreateLinkInput = {
  /** Our payment row id; lets the provider's records be traced back. */
  reference: string;
  amountPaise: number;
  currency: string;
  description: string;
  customer: { name: string; phone: string; email?: string | null };
  callbackUrl: string;
};

export type CreatedLink = { orderId: string; url: string };

export type PaymentEvent = {
  /** Unique per delivery target, for idempotency. */
  eventId: string;
  type: "PAID" | "FAILED" | "CANCELLED" | "REFUNDED" | "IGNORED";
  orderId?: string;
  paymentId?: string;
  amountPaise?: number;
  rawType: string;
};

export type WebhookHeaders = { get(name: string): string | null };

/** To add a provider: implement this and register it in ./index.ts. */
export type PaymentProvider = {
  name: string;
  isConfigured(): boolean;
  createPaymentLink(input: CreateLinkInput): Promise<CreatedLink>;
  cancelPaymentLink(orderId: string): Promise<void>;
  /** Whether this request's headers say it came from this provider. */
  matchesWebhook(headers: WebhookHeaders): boolean;
  verifyWebhook(rawBody: string, headers: WebhookHeaders): boolean;
  parseWebhook(rawBody: string, headers: WebhookHeaders): PaymentEvent;
};
