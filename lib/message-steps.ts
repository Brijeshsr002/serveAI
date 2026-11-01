// The map of "what happens" to "what the customer is told". Client-safe: no database access here.

const JOB_VARS = ["customer_name", "service_number", "vehicle_model", "registration", "tracking_link", "garage_name", "garage_phone"];
const BILL_VARS = [...JOB_VARS, "item_name", "item_cost", "bill_total"];
const PAYMENT_VARS = [...JOB_VARS, "amount"];

export const MESSAGE_STEPS = [
  { key: "NEW", group: "Job steps", label: "New job", when: "A new service job is created", vars: JOB_VARS, text: "Thanks! We've received your service request. Your service ID is {{service_number}}.\nTrack it here: {{tracking_link}}" },
  { key: "ASSIGNED", group: "Job steps", label: "Assigned", when: "A worker is assigned", vars: JOB_VARS, text: "Hi {{customer_name}}, your vehicle service request {{service_number}} has been assigned to our service team." },
  { key: "VEHICLE_RECEIVED", group: "Job steps", label: "Vehicle received", when: "The car reaches the garage", vars: JOB_VARS, text: "Hi {{customer_name}}, your {{vehicle_model}} has been received at our service center." },
  { key: "INSPECTION", group: "Job steps", label: "Inspection", when: "Inspection starts", vars: JOB_VARS, text: "Hi {{customer_name}}, your {{vehicle_model}} is currently under inspection." },
  { key: "SERVICE_IN_PROGRESS", group: "Job steps", label: "Service in progress", when: "Work starts or resumes", vars: JOB_VARS, text: "Good news! The service for your {{vehicle_model}} has started." },
  { key: "WAITING_FOR_PARTS", group: "Job steps", label: "Waiting for parts", when: "Work pauses for parts", vars: JOB_VARS, text: "Your vehicle service is currently waiting for required parts. We will update you once work resumes." },
  { key: "READY_FOR_DELIVERY", group: "Job steps", label: "Ready for delivery", when: "The car is ready", vars: JOB_VARS, text: "Your vehicle is ready for delivery. Please use the link below to view the service details and payment information.\n{{tracking_link}}" },
  { key: "COMPLETED", group: "Job steps", label: "Completed", when: "The job is completed", vars: JOB_VARS, text: "Your vehicle service has been completed. Thank you for choosing us." },
  { key: "CANCELLED", group: "Job steps", label: "Cancelled", when: "The job is cancelled", vars: JOB_VARS, text: "Your vehicle service request {{service_number}} has been cancelled. Please contact us if this is unexpected." },
  { key: "ITEM_APPROVAL", group: "Extra work and parts", label: "Ask customer to approve", when: "Extra work is found and needs the customer's yes", vars: BILL_VARS, text: "Hi {{customer_name}}, while working on your {{vehicle_model}} we found: {{item_name}}. It will cost {{item_cost}}.\nReply YES to add it, or NO to skip it. You can also choose here: {{tracking_link}}", alwaysOn: true },
  { key: "ITEM_ADDED", group: "Extra work and parts", label: "Part or work added", when: "A part, labour or cost is added to the bill", vars: BILL_VARS, text: "Hi {{customer_name}}, we added {{item_name}} ({{item_cost}}) to your {{vehicle_model}} service. Your bill is now {{bill_total}}.\nDetails: {{tracking_link}}" },
  { key: "ITEM_UPDATED", group: "Extra work and parts", label: "Part or work changed", when: "A bill line is edited", vars: BILL_VARS, text: "Hi {{customer_name}}, we updated {{item_name}} to {{item_cost}} on your {{vehicle_model}} service. Your bill is now {{bill_total}}.\nDetails: {{tracking_link}}" },
  { key: "ITEM_REMOVED", group: "Extra work and parts", label: "Part or work removed", when: "A bill line is removed", vars: BILL_VARS, text: "Hi {{customer_name}}, we removed {{item_name}} from your {{vehicle_model}} service. Your bill is now {{bill_total}}.\nDetails: {{tracking_link}}" },
  { key: "PAYMENT_REQUEST", group: "Payment and invoice", label: "Payment request", when: "A payment link is sent", vars: [...PAYMENT_VARS, "payment_link"], text: "Your final service amount is {{amount}}.\nClick below to view your invoice and make payment.\n{{payment_link}}" },
  { key: "PAYMENT_CONFIRMATION", group: "Payment and invoice", label: "Payment received", when: "A payment is confirmed", vars: PAYMENT_VARS, text: "Payment of {{amount}} has been received successfully.\nThank you for choosing {{garage_name}}." },
  { key: "INVOICE", group: "Payment and invoice", label: "Invoice", when: "Staff press Send on WhatsApp", vars: [...JOB_VARS, "invoice_number"], text: "Invoice {{invoice_number}} for {{service_number}}", alwaysOn: true },
] as const;

export type MessageStep = (typeof MESSAGE_STEPS)[number];
export type StepKey = MessageStep["key"];

export function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}
