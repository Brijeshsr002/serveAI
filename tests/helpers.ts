import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { vi } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { db, nextCustomerCode, nextVehicleCode } from "@/lib/db";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { createJob } from "@/lib/services/jobs";

export const PASSWORD = "Password123!";
const HASH = bcrypt.hashSync(PASSWORD, 4);

export type Sent = { url: string; method: string; body: any; headers: Record<string, string> };
export const fake = { calls: [] as Sent[], fail: null as null | { status: number; code: string } };

/** Stands in for api.sendiee.com and api.razorpay.com at the network boundary only. */
export function installFakeApis() {
  fake.calls = [];
  fake.fail = null;
  let counter = 0;
  vi.stubGlobal("fetch", async (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    fake.calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body as string) : undefined,
      headers: init.headers as Record<string, string>,
    });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (fake.fail) return json(fake.fail.status, { success: false, code: fake.fail.code, message: "fake failure" });
    if (url.includes("/v1/payment_links")) {
      counter++;
      return json(200, { id: `plink_${counter}`, short_url: `https://rzp.io/i/${counter}` });
    }
    if (url.includes("/v2.0/whatsapp/")) {
      counter++;
      return json(200, { success: true, data: { messageId: `wamid.out${counter}`, status: "accepted", recipient: "x" } });
    }
    if (url.includes("/v2.0/contacts")) return json(200, { success: true, data: { _id: "c1", phone: "x", isNew: false } });
    if (url.includes("/v2.0/chats/history")) {
      return json(200, {
        success: true,
        data: [
          { messageId: "m1", wamid: "wamid.hist1", direction: "inbound", internal: false, status: "received", type: "text", text: "Hello from history", createdAt: "2026-10-30T05:18:00.000Z" },
          { messageId: "m2", wamid: "wamid.hist2", direction: "outbound", internal: true, status: "sent", type: "text", text: "internal note", createdAt: "2026-10-30T05:19:00.000Z" },
        ],
        pagination: { limit: 100, hasMore: false, nextCursor: null },
        contact: { phone: "x", window: { open: true, lastInboundAt: new Date().toISOString(), closesAt: null } },
      });
    }
    return json(404, { success: false, code: "NOT_FOUND", message: "unstubbed" });
  });
}

export const sendieeCalls = () => fake.calls.filter((c) => c.url.includes("/v2.0/whatsapp/"));

export const makeUser = (role: Role, name: string) =>
  db.user.create({
    data: { name, email: `${name.toLowerCase()}@test.local`, passwordHash: HASH, role },
  });

export async function loginCookie(email: string, password = PASSWORD) {
  const res = await loginRoute(request("POST", "/api/auth/login", { body: { email, password } }));
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`login failed for ${email}: ${res.status}`);
  return setCookie.split(";")[0];
}

export function request(
  method: string,
  path: string,
  opts: { body?: unknown; raw?: string; cookie?: string; headers?: Record<string, string> } = {},
) {
  return new NextRequest(`https://serveai.test${path}`, {
    method,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    headers: {
      host: "serveai.test",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...opts.headers,
    },
  });
}

type Handler = (req: NextRequest, args?: { params: Promise<Record<string, string>> }) => Promise<Response>;

export async function call(
  handler: Handler,
  method: string,
  opts: { body?: unknown; raw?: string; cookie?: string; params?: Record<string, string>; headers?: Record<string, string>; path?: string } = {},
) {
  const res = await handler(request(method, opts.path ?? "/api/x", opts), { params: Promise.resolve(opts.params ?? {}) });
  const isJson = res.headers.get("content-type")?.includes("json");
  return { status: res.status, json: isJson ? ((await res.json()) as any) : null, res };
}

export async function makeCustomer(phone = "919876543210", name = "Brijesh") {
  return db.customer.create({ data: { name, phone, customerCode: await nextCustomerCode() } });
}

export async function makeVehicle(customerId: string, registrationNumber = "TN38AB1234", model = "Creta") {
  return db.vehicle.create({
    data: { customerId, registrationNumber, brand: "Hyundai", model, vehicleCode: await nextVehicleCode() },
  });
}

export async function makeJob(serviceType = "General Service") {
  const customer = await makeCustomer();
  const vehicle = await makeVehicle(customer.id);
  const job = await createJob(SYSTEM_ACTOR, {
    customerId: customer.id,
    vehicleId: vehicle.id,
    serviceType,
    customerComplaint: "Noise",
    internalNotes: "SECRET-INTERNAL-NOTE",
    estimatedAmount: 3000,
    appointmentDate: null,
    expectedCompletion: null,
  });
  return { customer, vehicle, job };
}

export function openWindow(customerId: string) {
  return db.whatsappConversation.upsert({
    where: { customerId },
    create: { customerId, lastInboundAt: new Date() },
    update: { lastInboundAt: new Date() },
  });
}

export function razorpaySignature(raw: string, secret = "rzp_webhook_secret") {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

export const webhookHeaders = { "x-webhook-secret": "test-webhook-secret" };
