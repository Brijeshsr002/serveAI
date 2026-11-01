import type { PaymentStatus, ServiceStatus } from "@prisma/client";

export const STATUSES: ServiceStatus[] = [
  "NEW",
  "ASSIGNED",
  "VEHICLE_RECEIVED",
  "INSPECTION",
  "SERVICE_IN_PROGRESS",
  "WAITING_FOR_PARTS",
  "READY_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
];

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  VEHICLE_RECEIVED: "Vehicle Received",
  INSPECTION: "Inspection",
  SERVICE_IN_PROGRESS: "Service In Progress",
  WAITING_FOR_PARTS: "Waiting for Parts",
  READY_FOR_DELIVERY: "Ready for Delivery",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const STATUS_COLOR: Record<ServiceStatus, string> = {
  NEW: "bg-slate-100 text-slate-700",
  ASSIGNED: "bg-indigo-100 text-indigo-700",
  VEHICLE_RECEIVED: "bg-sky-100 text-sky-700",
  INSPECTION: "bg-violet-100 text-violet-700",
  SERVICE_IN_PROGRESS: "bg-blue-100 text-blue-700",
  WAITING_FOR_PARTS: "bg-amber-100 text-amber-800",
  READY_FOR_DELIVERY: "bg-teal-100 text-teal-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-700",
};

export const PAYMENT_COLOR: Record<PaymentStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  PROCESSING: "bg-blue-100 text-blue-700",
  PAID: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-700",
  REFUNDED: "bg-violet-100 text-violet-700",
  CANCELLED: "bg-slate-100 text-slate-700",
};

export const TRANSITIONS: Record<ServiceStatus, ServiceStatus[]> = {
  NEW: ["ASSIGNED"],
  ASSIGNED: ["VEHICLE_RECEIVED"],
  VEHICLE_RECEIVED: ["INSPECTION"],
  INSPECTION: ["SERVICE_IN_PROGRESS"],
  SERVICE_IN_PROGRESS: ["WAITING_FOR_PARTS", "READY_FOR_DELIVERY"],
  WAITING_FOR_PARTS: ["SERVICE_IN_PROGRESS"],
  READY_FOR_DELIVERY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const TERMINAL: ServiceStatus[] = ["COMPLETED", "CANCELLED"];
export const ACTIVE_STATUSES = STATUSES.filter((s) => !TERMINAL.includes(s));

export const isTerminal = (s: ServiceStatus) => TERMINAL.includes(s);

/** Button text a worker sees for moving a job into each status. */
export const WORKER_ACTION: Partial<Record<ServiceStatus, string>> = {
  VEHICLE_RECEIVED: "Vehicle Received",
  INSPECTION: "Start Inspection",
  SERVICE_IN_PROGRESS: "Start Service",
  WAITING_FOR_PARTS: "Waiting for Parts",
  READY_FOR_DELIVERY: "Ready for Delivery",
  COMPLETED: "Complete Job",
};

/**
 * Stages admin and reception may move an open job to, in any order. assertStatusChangeAllowed enforces this on the server.
 * ASSIGNED is left out because it needs a worker, so it happens through the assign action.
 */
export const boardTargets = (s: ServiceStatus): ServiceStatus[] =>
  isTerminal(s) ? [] : STATUSES.filter((n) => n !== s && n !== "NEW" && n !== "ASSIGNED");

/** Spoken words for each step. Longer phrases are tried first, so "start inspection" isn't read as "start service". */
const VOICE_WORDS: [ServiceStatus, string[]][] = [
  ["WAITING_FOR_PARTS", ["waiting for parts", "waiting for part", "waiting", "need parts", "spare parts", "parts"]],
  ["READY_FOR_DELIVERY", ["ready for delivery", "ready to deliver", "delivery", "ready"]],
  ["VEHICLE_RECEIVED", ["vehicle received", "car received", "bike received", "received", "arrived"]],
  ["INSPECTION", ["start inspection", "inspection", "inspect", "checking"]],
  ["SERVICE_IN_PROGRESS", ["start service", "service started", "service in progress", "in progress", "resume", "start work", "started work"]],
  ["COMPLETED", ["complete job", "job complete", "completed", "complete", "finished", "finish", "done"]],
];

/** Only ever returns one of the steps on offer. */
export function matchVoiceStatus(spoken: string, options: ServiceStatus[]): ServiceStatus | null {
  const said = ` ${spoken.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const [status, words] of VOICE_WORDS) {
    if (options.includes(status) && words.some((w) => said.includes(` ${w} `))) return status;
  }
  return null;
}

/** Next statuses a worker may choose. ASSIGNED only happens through the assign action. */
export const workerNextStatuses = (s: ServiceStatus) => TRANSITIONS[s].filter((n) => n !== "ASSIGNED");
