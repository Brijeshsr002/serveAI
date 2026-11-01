import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/whatsapp/templates/route";
import { POST as send } from "@/app/api/whatsapp/send/route";
import { call, loginCookie, makeJob, makeUser, openWindow, sendieeCalls } from "./helpers";

describe("templates in the typing bar", () => {
  const get = (cookie: string, customerId: string) => call(GET, "GET", { cookie, path: `/api/whatsapp/templates?customerId=${customerId}` });

  it("fills in the customer's details and keeps what it can't fill visible", async () => {
    const cookie = await loginCookie((await makeUser("RECEPTIONIST", "Rita")).email);
    const { job, customer } = await makeJob();
    const { status, json } = await get(cookie, customer.id);
    expect(status).toBe(200);
    expect(json.data.serviceJobId).toBe(job.id);
    const update = json.data.approved.find((t: { label: string }) => t.label === "Status update");
    expect(update.params[0].value).toBe(customer.name);
    expect(update.params[1].value).toBe(job.serviceNumber);
    const invoice = json.data.approved.find((t: { label: string }) => t.label === "Invoice");
    expect(invoice.params[1].value).toBe("");
    const paymentAsk = json.data.messages.find((m: { key: string }) => m.key === "PAYMENT_REQUEST");
    expect(paymentAsk.text).toContain("{{payment_link}}");
  });

  it("is staff only", async () => {
    const cookie = await loginCookie((await makeUser("WORKER", "Raj")).email);
    const { customer } = await makeJob();
    expect((await get(cookie, customer.id)).status).toBe(403);
  });

  it("sends a chosen template, outside the 24 hours too, but refuses a blank detail", async () => {
    const cookie = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const { customer } = await makeJob();
    const body = { customerId: customer.id, templateName: "serveai_service_update", text: "Hi", bodyParameters: ["A", "B", "C", "D"] };
    expect((await call(send, "POST", { cookie, body })).status).toBe(201);
    expect(sendieeCalls()).toHaveLength(1);
    expect((await call(send, "POST", { cookie, body: { ...body, bodyParameters: ["A", " ", "C", "D"] } })).status).toBe(400);
    expect(sendieeCalls()).toHaveLength(1);
  });

  it("still allows free typing within 24 hours, and refuses it after", async () => {
    const cookie = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const { customer } = await makeJob();
    const body = { customerId: customer.id, text: "Your car is nearly ready" };
    expect((await call(send, "POST", { cookie, body })).status).toBe(409);
    await openWindow(customer.id);
    expect((await call(send, "POST", { cookie, body })).status).toBe(201);
  });
});
