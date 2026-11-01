import { SettingsForm } from "@/components/settings-form";
import { PageHeader, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { getSettings } from "@/lib/settings";

export default async function SettingsPage() {
  await requireRole(["ADMIN"]);
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
              { key: "center_email", label: "Contact email" },
            ],
          },
          {
            title: "Price list",
            hint: "A fallback only: approved rates in Service Types come first. One per line, like Car Wash = 300, for anything without a rate there.",
            fields: [{ key: "price_list", label: "Prices (₹)", long: true }],
          },
          {
            title: "Automatic assignment",
            hint: "When on, marking a worker on leave for today moves their open jobs to workers who are in, fewest active jobs first, and new jobs without a worker are assigned the same way. Customers aren't told about a move.",
            fields: [{ key: "auto_assign_enabled", label: "Assign and reassign jobs automatically", toggle: true }],
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
