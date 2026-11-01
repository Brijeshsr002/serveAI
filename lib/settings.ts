import type { ServiceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { MESSAGE_STEPS, type StepKey } from "@/lib/message-steps";
import { DEFAULT_PRICE_LIST } from "@/lib/work-catalog";

export { fill } from "@/lib/message-steps";

const BASE_DEFAULTS = {
  center_name: "Car's Spa",
  center_phone: "",
  center_address: "",
  center_email: "",
  auto_assign_enabled: "false",
  whatsapp_commands_enabled: "true",
  // Meta-approved template names, used outside the 24-hour window. Blank = skip when the window is closed.
  template_status_update: "serveai_service_update",
  template_payment_request: "serveai_payment_request",
  template_payment_confirmation: "serveai_payment_received",
  template_invoice: "serveai_invoice",
  template_language: "en",
  price_list: DEFAULT_PRICE_LIST,
  booking_enabled: "true",
  booking_slot_times: "10:00, 12:00, 15:00, 17:00",
  booking_slot_capacity: "2",
  booking_days_ahead: "3",
};

/** Each message step has its text (msg_), an on/off switch (notify_), and an optional template of its own (tpl_). */
export type SettingKey = keyof typeof BASE_DEFAULTS | `msg_${StepKey}` | `notify_${StepKey}` | `tpl_${StepKey}`;

export const SETTING_DEFAULTS = {
  ...BASE_DEFAULTS,
  ...Object.fromEntries(
    MESSAGE_STEPS.flatMap((s) => [
      [`msg_${s.key}`, s.text],
      [`notify_${s.key}`, "true"],
      [`tpl_${s.key}`, ""],
    ]),
  ),
} as Record<SettingKey, string>;

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await db.setting.findMany();
  const out = { ...SETTING_DEFAULTS };
  for (const row of rows) if (row.key in out) out[row.key as SettingKey] = row.value;
  return out;
}

export const statusMessageKey = (s: ServiceStatus) => `msg_${s}` as SettingKey;

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const trackingUrl = (token: string) => `${appUrl()}/track/${token}`;
