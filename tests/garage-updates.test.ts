import { beforeEach, describe, expect, it } from "vitest";
import { POST as addItem } from "@/app/api/service-jobs/[id]/items/route";
import { DELETE as removeItem, PATCH as editItem } from "@/app/api/service-jobs/[id]/items/[itemId]/route";
import { POST as createJob } from "@/app/api/service-jobs/route";
import { PATCH as saveSettings } from "@/app/api/settings/route";
import { db } from "@/lib/db";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { generateInvoice, invoiceInclude } from "@/lib/services/invoices";
import { replyForMessage } from "@/lib/services/whatsapp-commands";
import { slotTimes } from "@/lib/services/whatsapp-booking";
import { matchVoiceStatus } from "@/lib/status";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { call, fake, loginCookie, makeCustomer, makeJob, makeUser, makeVehicle, openWindow, sendieeCalls } from "./helpers";

const part = { itemType: "PART", name: "Brake Pads", quantity: "2", unitPrice: "900" };

describe("worker adds parts and extra work", () => {
  let worker: string, workerId: string, other: string;

  beforeEach(async () => {
    const w = await makeUser("WORKER", "Raj");
    workerId = w.id;
    worker = await loginCookie(w.email);
    other = await loginCookie((await makeUser("WORKER", "Kumar")).email);
  });

  async function assignedJob() {
    const { job, customer } = await makeJob();
    await db.serviceJob.update({ where: { id: job.id }, data: { assignedWorkerId: workerId, status: "SERVICE_IN_PROGRESS" } });
    await openWindow(customer.id);
    return job;
  }

  it("adds a cost and messages the customer the new total", async () => {
    const job = await assignedJob();
    const { status } = await call(addItem, "POST", { cookie: worker, params: { id: job.id }, body: part });
    expect(status).toBe(201);
    const messages = sendieeCalls();
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0].body)).toContain("Brake Pads");
    expect(JSON.stringify(messages[0].body)).toMatch(/1,800/);
  });

  it("edits and removes, telling the customer each time", async () => {
    const job = await assignedJob();
    const { json } = await call(addItem, "POST", { cookie: worker, params: { id: job.id }, body: part });
    const params = { id: job.id, itemId: json.data.id };
    expect((await call(editItem, "PATCH", { cookie: worker, params, body: { ...part, unitPrice: "1000" } })).status).toBe(200);
    expect(Number((await db.serviceItem.findUniqueOrThrow({ where: { id: json.data.id } })).total)).toBe(2000);
    expect((await call(removeItem, "DELETE", { cookie: worker, params })).status).toBe(200);
    expect(sendieeCalls()).toHaveLength(3);
  });

  it("can't give a discount or add tax", async () => {
    const job = await assignedJob();
    const { json } = await call(addItem, "POST", { cookie: worker, params: { id: job.id }, body: { ...part, discount: "1800", tax: "50", notifyCustomer: false } });
    expect(Number(json.data.total)).toBe(1800);
    expect(sendieeCalls()).toHaveLength(1);
  });

  it("gets 404 on another worker's job", async () => {
    const job = await assignedJob();
    expect((await call(addItem, "POST", { cookie: other, params: { id: job.id }, body: part })).status).toBe(404);
    expect(await db.serviceItem.count({ where: { serviceJobId: job.id } })).toBe(0);
  });

  it("can't change the bill once a payment link is out or the job is closed", async () => {
    const job = await assignedJob();
    await db.payment.create({ data: { serviceJobId: job.id, customerId: job.customerId, amount: 100, paymentProvider: "seed", status: "PENDING" } });
    expect((await call(addItem, "POST", { cookie: worker, params: { id: job.id }, body: part })).json.error.code).toBe("PAYMENT_PENDING");
    await db.payment.deleteMany({ where: { serviceJobId: job.id } });
    await db.serviceJob.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
    expect((await call(addItem, "POST", { cookie: worker, params: { id: job.id }, body: part })).json.error.code).toBe("SERVICE_CLOSED");
  });

  it("keeps an existing invoice up to date", async () => {
    const job = await assignedJob();
    await call(addItem, "POST", { cookie: worker, params: { id: job.id }, body: part });
    await generateInvoice(SYSTEM_ACTOR, job.id);
    await call(addItem, "POST", { cookie: worker, params: { id: job.id }, body: { ...part, name: "Car Wash", quantity: "1", unitPrice: "200" } });
    expect(Number((await db.invoice.findUniqueOrThrow({ where: { serviceJobId: job.id } })).total)).toBe(2000);
  });
});

describe("customer messages", () => {
  it("staff creating a job tells the customer", async () => {
    const admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const customer = await makeCustomer();
    const vehicle = await makeVehicle(customer.id);
    await openWindow(customer.id);
    const { status } = await call(createJob, "POST", { cookie: admin, body: { customerId: customer.id, vehicleId: vehicle.id, serviceType: "Car Wash" } });
    expect(status).toBe(201);
    expect(sendieeCalls()).toHaveLength(1);
  });

  it("saves one step on its own, uses the new words, and honours the off switch", async () => {
    const admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    expect((await call(saveSettings, "PATCH", { cookie: admin, body: { msg_ASSIGNED: "Hello from {{garage_name}}" } })).status).toBe(200);
    const worker = await makeUser("WORKER", "Raj");
    const { job, customer } = await makeJob();
    await openWindow(customer.id);
    const { assignWorker } = await import("@/lib/services/jobs");
    await assignWorker(SYSTEM_ACTOR, job.id, worker.id);
    expect(JSON.stringify(sendieeCalls()[0].body)).toContain("Hello from Car's Spa");

    fake.calls = [];
    await call(saveSettings, "PATCH", { cookie: admin, body: { notify_VEHICLE_RECEIVED: "false" } });
    const { NotificationService, loadJobContext } = await import("@/lib/notifications");
    await NotificationService.sendServiceStatusUpdate(await loadJobContext(job.id), "VEHICLE_RECEIVED");
    expect(sendieeCalls()).toHaveLength(0);
    expect(await db.notification.count({ where: { serviceJobId: job.id, kind: "STATUS_VEHICLE_RECEIVED", status: "SKIPPED" } })).toBe(1);
  });
});

describe("colourful invoice", () => {
  it("renders with the garage's name and many lines", async () => {
    const { job } = await makeJob();
    for (let i = 0; i < 30; i++) await db.serviceItem.create({ data: { serviceJobId: job.id, itemType: "PART", name: `Part ${i}`, unitPrice: 10, total: 10 } });
    const { id } = await generateInvoice(SYSTEM_ACTOR, job.id);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
    const pdf = await renderInvoicePdf(invoice, "UNPAID", { name: "Sri Murugan Car Care", phone: "9876543210", address: "Coimbatore" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("voice commands", () => {
  it("matches a spoken step only if it's on offer", () => {
    expect(matchVoiceStatus("Start Service", ["SERVICE_IN_PROGRESS"])).toBe("SERVICE_IN_PROGRESS");
    expect(matchVoiceStatus("we are waiting for parts", ["WAITING_FOR_PARTS", "READY_FOR_DELIVERY"])).toBe("WAITING_FOR_PARTS");
    expect(matchVoiceStatus("car is ready", ["WAITING_FOR_PARTS", "READY_FOR_DELIVERY"])).toBe("READY_FOR_DELIVERY");
    expect(matchVoiceStatus("job complete", ["READY_FOR_DELIVERY"])).toBeNull();
    expect(matchVoiceStatus("what time is lunch", ["COMPLETED"])).toBeNull();
    expect(matchVoiceStatus("abandoned", ["COMPLETED"])).toBeNull();
  });
});

describe("WhatsApp slot booking", () => {
  const conversationFor = async (customerId: string) => {
    await db.whatsappConversation.upsert({ where: { customerId }, create: { customerId }, update: {} });
  };

  async function bookedCustomer(phone = "919000000001", reg = "TN38AB0001") {
    const customer = await makeCustomer(phone, "Asha");
    await makeVehicle(customer.id, reg);
    await conversationFor(customer.id);
    await db.serviceType.upsert({ where: { name: "Car Wash" }, create: { name: "Car Wash" }, update: {} });
    return customer;
  }

  const serviceNumber = async () => {
    const types = await db.serviceType.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 20 });
    return String(types.findIndex((t) => t.name === "Car Wash") + 1);
  };

  it("offers only future slot times, in garage time", () => {
    const now = new Date("2026-11-02T06:30:00.000Z"); // 12:00 IST
    const slots = slotTimes({ booking_slot_times: "10:00, 12:00, 15:00, junk", booking_days_ahead: "1" }, now);
    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-11-02T09:30:00.000Z",
      "2026-11-03T04:30:00.000Z",
      "2026-11-03T06:30:00.000Z",
      "2026-11-03T09:30:00.000Z",
    ]);
  });

  it("books a slot step by step and creates a job", async () => {
    const customer = await bookedCustomer();
    expect((await replyForMessage(customer, "I want to book"))?.reply).toContain("What does your car need");
    expect((await replyForMessage(customer, await serviceNumber()))?.reply).toContain("Choose a time");
    const done = await replyForMessage(customer, "1");
    expect(done?.reply).toContain("You're booked");
    const job = await db.serviceJob.findUniqueOrThrow({ where: { id: done!.jobId } });
    expect(job).toMatchObject({ serviceType: "Car Wash", status: "NEW", customerId: customer.id });
    expect(job.appointmentDate).not.toBeNull();
    expect((await db.whatsappConversation.findUniqueOrThrow({ where: { customerId: customer.id } })).pendingChoice).toBeNull();
  });

  it("won't overfill a slot someone took in the meantime", async () => {
    const first = await bookedCustomer("919000000002", "TN38AB0002");
    await replyForMessage(first, "book");
    await replyForMessage(first, await serviceNumber());
    const pending = (await db.whatsappConversation.findUniqueOrThrow({ where: { customerId: first.id } })).pendingChoice as { slots: string[] };
    await db.setting.create({ data: { key: "booking_slot_capacity", value: "1" } });
    const { job } = await makeJob();
    await db.serviceJob.update({ where: { id: job.id }, data: { appointmentDate: new Date(pending.slots[0]) } });
    const reply = await replyForMessage(first, "1");
    expect(reply?.reply).toContain("that time has just gone");
    expect(reply?.jobId).toBeUndefined();
  });

  it("can be cancelled, and ordinary chat isn't interrupted", async () => {
    const customer = await bookedCustomer("919000000003", "TN38AB0003");
    await replyForMessage(customer, "appointment please");
    expect(await replyForMessage(customer, "thanks, one moment")).toBeNull();
    expect((await replyForMessage(customer, "99"))?.reply).toContain("Please reply with a number");
    expect((await replyForMessage(customer, "cancel"))?.reply).toContain("booking stopped");
    expect(await replyForMessage(customer, "1")).toBeNull();
  });

  it("won't double book a vehicle already in for service", async () => {
    const customer = await bookedCustomer("919000000004", "TN38AB0004");
    const vehicle = await db.vehicle.findFirstOrThrow({ where: { customerId: customer.id } });
    await db.serviceJob.create({ data: { customerId: customer.id, vehicleId: vehicle.id, serviceType: "Oil Change", serviceNumber: "SRV-Y", trackingToken: "y".repeat(64) } });
    expect((await replyForMessage(customer, "book"))?.reply).toContain("already booked in");
  });
});
