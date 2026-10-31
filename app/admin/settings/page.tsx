import { SettingsForm } from "@/components/settings-form";
import { PageHeader } from "@/components/ui-kit";
import { getSettings } from "@/lib/settings";
import { STATUS_LABEL } from "@/lib/status";
import type { ServiceStatus } from "@prisma/client";

const STATUS_MESSAGES: ServiceStatus[] = ["ASSIGNED", "VEHICLE_RECEIVED", "INSPECTION", "SERVICE_IN_PROGRESS", "WAITING_FOR_PARTS", "READY_FOR_DELIVERY", "COMPLETED", "CANCELLED"];

export default async function SettingsPage() {
  const values = await getSettings();
  return (
    <>
      <PageHeader title="Settings" subtitle="API keys and secrets are environment variables and never appear here" />
      <SettingsForm
        values={values}
        groups={[
          {
            title: "Service center",
            fields: [
              { key: "center_name", label: "Name" },
              { key: "center_phone", label: "Contact phone" },
              { key: "center_address", label: "Address" },
            ],
          },
          {
            title: "WhatsApp automation",
            hint: "Turn commands off if your Sendiee AI assistant already answers status questions, so customers don't get two replies.",
            fields: [{ key: "whatsapp_commands_enabled", label: "Auto-answer status, amount, payment and invoice questions", toggle: true }],
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
          {
            title: "Status messages",
            hint: "Sent inside the 24-hour window. Placeholders: {{customer_name}}, {{service_number}}, {{vehicle_model}}, {{registration}}, {{tracking_link}}",
            fields: STATUS_MESSAGES.map((s) => ({ key: `msg_${s}`, label: STATUS_LABEL[s], long: true })),
          },
        ]}
      />
    </>
  );
}
