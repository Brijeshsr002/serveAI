import type { ServiceStatus } from "@prisma/client";
import { db } from "@/lib/db";

export const SETTING_DEFAULTS = {
  center_name: "ServAI Service Center",
  center_phone: "",
  center_address: "",
  whatsapp_commands_enabled: "true",
  // Meta-approved template names, used outside the 24-hour window. Blank = skip when the window is closed.
  template_status_update: "serveai_service_update",
  template_payment_request: "serveai_payment_request",
  template_payment_confirmation: "serveai_payment_received",
  template_invoice: "serveai_invoice",
  template_language: "en",
  msg_ASSIGNED: "Hi {{customer_name}}, your vehicle service request {{service_number}} has been assigned to our service team.",
  msg_VEHICLE_RECEIVED: "Hi {{customer_name}}, your {{vehicle_model}} has been received at our service center.",
  msg_INSPECTION: "Hi {{customer_name}}, your {{vehicle_model}} is currently under inspection.",
  msg_SERVICE_IN_PROGRESS: "Good news! The service for your {{vehicle_model}} has started.",
  msg_WAITING_FOR_PARTS: "Your vehicle service is currently waiting for required parts. We will update you once work resumes.",
  msg_READY_FOR_DELIVERY: "Your vehicle is ready for delivery. Please use the link below to view the service details and payment information.\n{{tracking_link}}",
  msg_COMPLETED: "Your vehicle service has been completed. Thank you for choosing us.",
  msg_CANCELLED: "Your vehicle service request {{service_number}} has been cancelled. Please contact us if this is unexpected.",
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await db.setting.findMany();
  const out = { ...SETTING_DEFAULTS };
  for (const row of rows) if (row.key in out) out[row.key as SettingKey] = row.value;
  return out;
}

export const statusMessageKey = (s: ServiceStatus) => `msg_${s}` as SettingKey;

export function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const trackingUrl = (token: string) => `${appUrl()}/track/${token}`;
