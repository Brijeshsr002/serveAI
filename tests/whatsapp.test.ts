import { beforeEach, describe, expect, it } from "vitest";
import { POST as webhook } from "@/app/api/webhooks/sendiee/route";
import { POST as intake } from "@/app/api/webhooks/sendiee/service-request/route";
import { GET as slots } from "@/app/api/webhooks/sendiee/slots/route";
import { POST as carStatus } from "@/app/api/webhooks/sendiee/status/route";
import { POST as send } from "@/app/api/whatsapp/send/route";
import { POST as syncRoute } from "@/app/api/whatsapp/conversations/[customerId]/sync/route";
import { db } from "@/lib/db";
import { NotificationService, loadJobContext } from "@/lib/notifications";
import { normalizeSendieeEvent } from "@/lib/sendiee/normalizer";
import { call, fake, loginCookie, makeCustomer, makeJob, makeUser, makeVehicle, openWindow, sendieeCalls, webhookHeaders } from "./helpers";
import { createJob } from "@/lib/services/jobs";
import { SYSTEM_ACTOR } from "@/lib/activity";

const inbound = (over: object = {}) => ({
  event: "whatsapp.new_message",
  data: { phone: "919876543210", wamid: "wamid.in1", text: "Hello", contactName: "Asha", ...over },
});

const deliver = (body: unknown) => call(webhook, "POST", { raw: JSON.stringify(body), headers: webhookHeaders });

describe("WhatsApp service", () => {
  it("uses freeform inside the 24-hour window, with the brand number and no key in the body", async () => {
    const { job, customer } = await makeJob();
    await openWindow(customer.id);
    await NotificationService.sendServiceStatusUpdate(await loadJobContext(job.id), "INSPECTION");
    const [c] = sendieeCalls();
    expect(c.url).toBe("https://api.sendiee.com/v2.0/whatsapp/message");
    expect(c.body).toMatchObject({ to: "919876543210", brandNumber: "917012345678", type: "text" });
    expect(c.body.content.body).toContain("under inspection");
    expect(c.headers.Authorization).toBe("Bearer test-sendiee-key");
    expect(JSON.stringify(c.body)).not.toContain("test-sendiee-key");
  });

  it("sends freeform even when the customer hasn't messaged lately, never a template", async () => {
    const { job } = await makeJob();
    await NotificationService.sendServiceStatusUpdate(await loadJobContext(job.id), "INSPECTION");
    const [c] = sendieeCalls();
    expect(c.url).toBe("https://api.sendiee.com/v2.0/whatsapp/message");
    expect(c.body.templateName).toBeUndefined();
    expect(await db.notification.count({ where: { status: "SENT" } })).toBe(1);
  });

  it("stores outbound messages with the wamid and a failed send with its error", async () => {
    const { job, customer } = await makeJob();
    await openWindow(customer.id);
    await NotificationService.sendServiceStatusUpdate(await loadJobContext(job.id), "INSPECTION");
    const ok = await db.whatsappMessage.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(ok.sendieeMessageId).toMatch(/^wamid\.out/);
    expect(ok.status).toBe("ACCEPTED");

    fake.fail = { status: 404, code: "TEMPLATE_NOT_FOUND" };
    await NotificationService.sendServiceStatusUpdate(await loadJobContext(job.id), "SERVICE_IN_PROGRESS");
    const bad = await db.whatsappMessage.findFirstOrThrow({ where: { status: "FAILED" } });
    expect(bad.error).toContain("TEMPLATE_NOT_FOUND");
  });

  it("never retries a send, so a customer cannot get it twice", async () => {
    const { job, customer } = await makeJob();
    await openWindow(customer.id);
    fake.fail = { status: 500, code: "MESSAGE_SEND_FAILED" };
    await NotificationService.sendServiceStatusUpdate(await loadJobContext(job.id), "INSPECTION");
    expect(sendieeCalls()).toHaveLength(1);
  });

  it("lets staff send freeform without waiting for the customer to message", async () => {
    const cookie = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    const c = await makeCustomer();
    const { status } = await call(send, "POST", { cookie, body: { customerId: c.id, text: "Hi" } });
    expect(status).toBe(201);
    expect(sendieeCalls()).toHaveLength(1);
  });

  it("syncs documented chat history, skipping internal notes, without duplicating", async () => {
    const cookie = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    const c = await makeCustomer();
    const first = await call(syncRoute, "POST", { cookie, params: { customerId: c.id } });
    expect(first.json.data.imported).toBe(1);
    const second = await call(syncRoute, "POST", { cookie, params: { customerId: c.id } });
    expect(second.json.data.imported).toBe(0);
    const conv = await db.whatsappConversation.findUniqueOrThrow({ where: { customerId: c.id } });
    expect(conv.lastInboundAt).not.toBeNull();
  });
});

describe("Sendiee webhook", () => {
  it("rejects a missing or wrong secret and stores nothing", async () => {
    expect((await call(webhook, "POST", { raw: JSON.stringify(inbound()) })).status).toBe(401);
    expect((await call(webhook, "POST", { raw: JSON.stringify(inbound()), headers: { "x-webhook-secret": "wrong" } })).status).toBe(401);
    expect(await db.customer.count()).toBe(0);
  });

  it("creates the customer, stores the message and opens the window", async () => {
    const { status, json } = await deliver(inbound());
    expect(status).toBe(200);
    expect(json.data.outcome).toBe("stored");
    const customer = await db.customer.findUniqueOrThrow({ where: { phone: "919876543210" } });
    expect(customer.name).toBe("Asha");
    const conv = await db.whatsappConversation.findUniqueOrThrow({ where: { customerId: customer.id } });
    expect(conv).toMatchObject({ unreadCount: 1, lastMessage: "Hello" });
    expect(conv.lastInboundAt).not.toBeNull();
  });

  it("is idempotent: the same delivery twice changes nothing", async () => {
    await deliver(inbound());
    const again = await deliver(inbound());
    expect(again.json.data.outcome).toBe("duplicate");
    expect(await db.customer.count()).toBe(1);
    expect(await db.whatsappMessage.count()).toBe(1);
    expect((await db.whatsappConversation.findFirstOrThrow()).unreadCount).toBe(1);
  });

  it("stays idempotent when deliveries race, and dedupes id-less payloads by body", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => deliver(inbound())));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await db.customer.count()).toBe(1);
    expect(await db.whatsappMessage.count()).toBe(1);

    const noId = { event: "whatsapp.new_message", data: { phone: "919000000009", text: "No id" } };
    await deliver(noId);
    await deliver(noId);
    expect(await db.whatsappMessage.count({ where: { content: "No id" } })).toBe(1);
  });

  it("does not duplicate a customer when the number arrives in another format", async () => {
    await makeCustomer("919876543210", "Existing");
    await deliver(inbound({ phone: "+91 98765 43210" }));
    expect(await db.customer.count()).toBe(1);
    expect((await db.customer.findFirstOrThrow()).name).toBe("Existing");
  });

  it("links the message to the active job", async () => {
    const { job, customer } = await makeJob();
    await deliver(inbound({ phone: customer.phone }));
    const m = await db.whatsappMessage.findFirstOrThrow({ where: { direction: "INBOUND" } });
    expect(m.serviceJobId).toBe(job.id);
  });

  it("updates delivery status and never moves it backwards", async () => {
    const { customer } = await makeJob();
    await db.whatsappMessage.create({ data: { customerId: customer.id, direction: "OUTBOUND", content: "x", sendieeMessageId: "wamid.s1", status: "ACCEPTED" } });
    const status = (s: string) => deliver({ event: "whatsapp.message_status", data: { messageId: "wamid.s1", status: s } });
    await status("read");
    await status("delivered");
    expect((await db.whatsappMessage.findFirstOrThrow({ where: { sendieeMessageId: "wamid.s1" } })).status).toBe("READ");
  });

  it("keeps a payload it cannot understand for inspection and still returns 200", async () => {
    const { status, json } = await deliver({ event: "something.else", weird: true });
    expect(status).toBe(200);
    expect(json.data.outcome).toBe("unrecognized");
    expect((await db.webhookEvent.findFirstOrThrow()).payload).toMatchObject({ weird: true });
  });

  it("reads the alternative shapes the docs hint at", () => {
    const flat = normalizeSendieeEvent({ event: "whatsapp.new_message", from: "919000000001", message: "Hi", id: "abc" });
    expect(flat).toMatchObject({ kind: "message", direction: "INBOUND", phone: "919000000001", text: "Hi", messageId: "abc" });
    const nested = normalizeSendieeEvent({ payload: { contact: { phone: "919000000002", name: "N" }, message: { id: "w", text: { body: "Yo" } } } });
    expect(nested).toMatchObject({ kind: "message", phone: "919000000002", text: "Yo", name: "N" });
    const sent = normalizeSendieeEvent({ event: "whatsapp.message_sent", data: { to: "919000000003", text: "From AI", wamid: "w2" } });
    expect(sent).toMatchObject({ kind: "message", direction: "OUTBOUND", phone: "919000000003" });
  });
});

describe("Sendiee AI intake", () => {
  const payload = {
    phone: "9876543210",
    name: "Asha",
    brand: "Hyundai",
    model: "Creta",
    registrationNumber: "TN 38 AB 1234",
    serviceType: "General Service",
    complaint: "Brake noise",
    preferredDate: "2026-11-05",
    preferredTime: "10:30",
    externalRef: "conv-1",
  };
  const post = (body: object) => call(intake, "POST", { raw: JSON.stringify(body), headers: webhookHeaders });

  it("creates customer, vehicle and NEW job and sends the service ID", async () => {
    const { status, json } = await post(payload);
    expect(status).toBe(201);
    expect(json.data.serviceNumber).toMatch(/^SRV-/);
    const job = await db.serviceJob.findFirstOrThrow({ include: { vehicle: true, customer: true } });
    expect(job).toMatchObject({ status: "NEW", customerComplaint: "Brake noise" });
    expect(job.vehicle.registrationNumber).toBe("TN38AB1234");
    expect(job.appointmentDate?.toISOString()).toBe("2026-11-05T05:00:00.000Z");
    expect(sendieeCalls()).toHaveLength(1);
  });

  it("gives the assistant the tracking link for the new job", async () => {
    const { json } = await post(payload);
    const job = await db.serviceJob.findFirstOrThrow();
    expect(json.data.trackingUrl).toContain(job.trackingToken);
  });

  it("refuses a time that is already full", async () => {
    await post({ ...payload, externalRef: undefined });
    await post({ ...payload, externalRef: undefined, phone: "9876543211", registrationNumber: "TN 38 AB 1235" });
    const { status, json } = await post({ ...payload, externalRef: undefined, phone: "9876543212", registrationNumber: "TN 38 AB 1236" });
    expect(status).toBe(409);
    expect(json.error.code).toBe("SLOT_TAKEN");
    expect(await db.serviceJob.count()).toBe(2);
  });

  it("tells the assistant a car's status only when the phone and registration match", async () => {
    const ask = (body: object, headers: Record<string, string> = webhookHeaders) => call(carStatus, "POST", { raw: JSON.stringify(body), headers });
    await post(payload);
    const job = await db.serviceJob.findFirstOrThrow();
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "INSPECTION" } });

    expect((await ask({ phone: "9876543210", registrationNumber: "TN38AB1234" }, {})).status).toBe(401);
    const { status, json } = await ask({ phone: "9876543210", registrationNumber: "tn 38 ab 1234" });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ found: true, serviceNumber: job.serviceNumber, status: "Inspection" });
    expect(json.data.trackingUrl).toContain(job.trackingToken);

    const stranger = await ask({ phone: "9000000000", registrationNumber: "TN38AB1234" });
    expect(stranger.json.data).toEqual({ found: false });
    const unknown = await ask({ phone: "9876543210", registrationNumber: "TN01ZZ9999" });
    expect(unknown.json.data).toEqual({ found: false });
  });

  it("lists free slots and services behind the secret", async () => {
    await db.serviceType.create({ data: { name: "Oil Change", kind: "SERVICE", rate: 1500 } });
    const denied = await call(slots, "GET");
    expect(denied.status).toBe(401);
    const { status, json } = await call(slots, "GET", { headers: webhookHeaders });
    expect(status).toBe(200);
    expect(json.data.services).toContainEqual({ name: "Oil Change", price: expect.stringContaining("1,500") });
    expect(json.data.slots.length).toBeGreaterThan(0);
    expect(json.data.slots[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.data.slots[0].time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("does not duplicate on redelivery, with or without a reference", async () => {
    await post(payload);
    const again = await post(payload);
    expect(again.status).toBe(200);
    expect(again.json.data.duplicate).toBe(true);
    const noRef = await post({ ...payload, externalRef: undefined });
    expect(noRef.json.data.duplicate).toBe(true);
    expect(await db.serviceJob.count()).toBe(1);
    expect(await db.customer.count()).toBe(1);
    expect(await db.vehicle.count()).toBe(1);
  });

  it("refuses a registration that belongs to someone else", async () => {
    const owner = await makeCustomer("919111111111", "Owner");
    await makeVehicle(owner.id, "TN38AB1234");
    const { status, json } = await post(payload);
    expect(status).toBe(409);
    expect(json.error.code).toBe("VEHICLE_OWNED_BY_OTHER_CUSTOMER");
    expect(await db.serviceJob.count()).toBe(0);
  });

  it("requires the webhook secret", async () => {
    const { status } = await call(intake, "POST", { raw: JSON.stringify(payload) });
    expect(status).toBe(401);
  });
});

describe("customer WhatsApp commands", () => {
  const lastReply = () => sendieeCalls().at(-1)?.body.content.body as string;

  it("answers a status question for one active vehicle", async () => {
    const { customer } = await makeJob();
    await deliver(inbound({ phone: customer.phone, text: "What's my car status?" }));
    expect(lastReply()).toContain("Hyundai Creta TN38AB1234 is currently under New");
  });

  it("asks which vehicle when there are two, then answers the choice", async () => {
    const { customer } = await makeJob();
    const second = await makeVehicle(customer.id, "TN38CD5678", "City");
    await createJob(SYSTEM_ACTOR, {
      customerId: customer.id,
      vehicleId: second.id,
      serviceType: "AC",
      customerComplaint: null,
      internalNotes: null,
      estimatedAmount: null,
      appointmentDate: null,
      expectedCompletion: null,
    });
    await deliver(inbound({ phone: customer.phone, text: "What's the status?" }));
    expect(lastReply()).toContain("You have 2 active vehicles");
    expect(lastReply()).toContain("TN38CD5678");

    await deliver(inbound({ phone: customer.phone, wamid: "wamid.in2", text: "TN38CD5678" }));
    expect(lastReply()).toContain("TN38CD5678 is currently under");
    const conv = await db.whatsappConversation.findUniqueOrThrow({ where: { customerId: customer.id } });
    expect(conv.pendingChoice).toBeNull();
  });

  it("stays quiet on ordinary chat, and when commands are disabled", async () => {
    const { customer } = await makeJob();
    await deliver(inbound({ phone: customer.phone, text: "Thanks a lot" }));
    expect(sendieeCalls()).toHaveLength(0);
    await db.setting.create({ data: { key: "whatsapp_commands_enabled", value: "false" } });
    await deliver(inbound({ phone: customer.phone, wamid: "wamid.in3", text: "status?" }));
    expect(sendieeCalls()).toHaveLength(0);
  });

  it("does not leak another customer's job", async () => {
    await makeJob();
    await deliver(inbound({ phone: "919222222222", text: "status" }));
    expect(lastReply()).toContain("don't have an active service");
  });
});
