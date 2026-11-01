import { afterAll, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { resetRateLimits } from "@/lib/rate-limit";
import { installFakeApis } from "./helpers";

beforeEach(async () => {
  await db.$executeRawUnsafe(`
    TRUNCATE users, customers, vehicles, service_jobs, service_status_history, service_items,
      payments, invoices, invoice_items, whatsapp_messages, whatsapp_conversations, notifications,
      activity_logs, service_types, settings, sequences, webhook_events, attendance, staff_inactive_periods CASCADE`);
  resetRateLimits();
  installFakeApis();
  vi.spyOn(console, "error").mockImplementation(() => {});
  
});

afterAll(async () => {
  await db.$disconnect();
});
