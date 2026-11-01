import type { FormField } from "@/components/actions";
import { PART_NAMES, WORK_NAMES } from "@/lib/work-catalog";

export const customerFields: FormField[] = [
  { name: "name", label: "Name", required: true },
  { name: "phone", label: "WhatsApp phone", type: "tel", required: true, placeholder: "9876543210" },
  { name: "email", label: "Email", type: "email" },
  { name: "address", label: "Address" },
  { name: "city", label: "City" },
  { name: "notes", label: "Notes", type: "textarea" },
];

export const vehicleFields: FormField[] = [
  { name: "registrationNumber", label: "Registration number", required: true, placeholder: "TN38AB1234" },
  { name: "brand", label: "Brand", required: true, placeholder: "Hyundai" },
  { name: "model", label: "Model", required: true, placeholder: "Creta" },
  { name: "variant", label: "Variant" },
  { name: "manufacturingYear", label: "Year", type: "number" },
  {
    name: "fuelType",
    label: "Fuel",
    type: "select",
    options: ["", "Petrol", "Diesel", "CNG", "Electric", "Hybrid"].map((v) => ({ value: v, label: v || "—" })),
  },
  { name: "color", label: "Colour" },
  { name: "odometer", label: "Odometer (km)", type: "number" },
];

export const itemFields: FormField[] = [
  {
    name: "itemType",
    label: "Type",
    type: "select",
    required: true,
    options: [
      { value: "PART", label: "Part" },
      { value: "LABOUR", label: "Labour" },
      { value: "SERVICE", label: "Service" },
    ],
  },
  { name: "name", label: "Name (pick or type)", required: true, placeholder: "Engine Oil, Car Wash…", suggestions: [...PART_NAMES, ...WORK_NAMES] },
  { name: "description", label: "Description" },
  { name: "quantity", label: "Quantity", type: "number", required: true },
  { name: "unitPrice", label: "Unit price (₹)", type: "number", required: true },
  { name: "tax", label: "Tax amount (₹)", type: "number" },
  { name: "discount", label: "Discount amount (₹)", type: "number" },
  { name: "notifyCustomer", label: "Tell the customer on WhatsApp", type: "checkbox" },
  { name: "needsApproval", label: "Ask the customer to approve first (not billed until they say yes)", type: "checkbox" },
];


export const jobEditFields: FormField[] = [
  { name: "customerComplaint", label: "Customer complaint", type: "textarea" },
  { name: "internalNotes", label: "Internal notes (not shown to customer)", type: "textarea" },
  { name: "estimatedAmount", label: "Estimated cost (₹)", type: "number" },
  {
    name: "priority",
    label: "Priority",
    type: "select",
    options: ["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() })),
  },
  { name: "appointmentDate", label: "Appointment", type: "datetime-local" },
  { name: "expectedCompletion", label: "Expected completion", type: "datetime-local" },
];

export const userFields = (role: "WORKER" | "RECEPTIONIST"): FormField[] => [
  { name: "name", label: "Name", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "role", label: "Role", type: "select", options: [{ value: role, label: role === "WORKER" ? "Worker" : "Receptionist" }] },
];
