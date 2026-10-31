import { SettingsForm } from "@/components/settings-form";
import { PageHeader, TextLink } from "@/components/ui-kit";
import { getSettings } from "@/lib/settings";

export default async function SettingsPage() {
  const values = await getSettings();
  return (
    <>
      <PageHeader title="Settings" subtitle="API keys and secrets are environment variables and never appear here" />
      <p className="mb-4 text-sm">Change what customers are told at each step in <TextLink href="/admin/messages">Customer Messages</TextLink>.</p>
      <SettingsForm
        values={values}
        groups={[
          {
            title: "Your garage",
            hint: "Shown on invoices, the login page, the customer tracking page and WhatsApp messages.",
            fields: [
              { key: "center_name", label: "Garage name" },
              { key: "center_phone", label: "Contact phone" },
              { key: "center_address", label: "Address" },
            ],
          },
          {
            title: "WhatsApp automation",
            hint: "Turn commands off if your Sendiee AI assistant already answers status questions, so customers don't get two replies. Slot booking also stops when commands are off.",
            fields: [{ key: "whatsapp_commands_enabled", label: "Auto-answer status, amount, payment and invoice questions", toggle: true }],
          },
          {
            title: "WhatsApp slot booking",
            hint: "A customer sends BOOK, picks a vehicle, a service and a time, and a job is created. Service choices come from Service Types.",
            fields: [
              { key: "booking_enabled", label: "Let customers book slots on WhatsApp", toggle: true },
              { key: "booking_slot_times", label: "Slot times, 24-hour, separated by commas" },
              { key: "booking_slot_capacity", label: "Cars per slot" },
              { key: "booking_days_ahead", label: "Days ahead customers can book" },
            ],
          },
          {
            title: "Approved WhatsApp templates",
            hint: "Used when the customer hasn't messaged in 24 hours. Names must match templates approved in Sendiee. Leave blank to skip sending.",
            fields: [
              { key: "template_status_update", label: "Status update" },
              { key: "template_payment_request", label: "Payment request" },
              { key: "template_payment_confirmation", label: "Payment confirmation" },
              { key: "template_invoice", label: "Invoice" },
              { key: "template_language", label: "Template language" },
            ],
          },
        ]}
      />
    </>
  );
}
