import { Prisma, type Customer } from "@prisma/client";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { createJob } from "@/lib/services/jobs";
import { getSettings, trackingUrl } from "@/lib/settings";
import { ACTIVE_STATUSES } from "@/lib/status";

/** Where a customer is in the numbered booking conversation, kept on their WhatsApp conversation. */
export type BookingPending =
  | { intent: "BOOK"; stage: "VEHICLE"; vehicleIds: string[] }
  | { intent: "BOOK"; stage: "SERVICE"; vehicleId: string; types: string[] }
  | { intent: "BOOK"; stage: "SLOT"; vehicleId: string; serviceType: string; slots: string[] };

type Settings = Awaited<ReturnType<typeof getSettings>>;

const MAX_OFFERED = 8;
const MIN_NOTICE_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const isBookingRequest = (text: string) => /\b(book|booking|slot|appointment)\b/i.test(text);

const setPending = (customerId: string, pending: BookingPending | null) =>
  db.whatsappConversation.update({ where: { customerId }, data: { pendingChoice: pending ?? Prisma.DbNull } });

const numbered = (lines: string[]) => lines.map((line, i) => `${i + 1}. ${line}`).join("\n");

/** Slot times are garage-local (IST). Blank or invalid settings simply offer nothing. */
export function slotTimes(settings: Pick<Settings, "booking_slot_times" | "booking_days_ahead">, now = new Date()) {
  const times = settings.booking_slot_times.split(",").map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t)).map((t) => t.padStart(5, "0")).sort();
  const days = Math.min(Math.max(Number(settings.booking_days_ahead) || 0, 0), 30);
  const slots: Date[] = [];
  for (let d = 0; d <= days; d++) {
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(now.getTime() + d * DAY_MS));
    for (const t of times) {
      const slot = new Date(`${ymd}T${t}:00+05:30`);
      if (!Number.isNaN(slot.getTime()) && slot.getTime() - now.getTime() >= MIN_NOTICE_MS) slots.push(slot);
    }
  }
  return slots;
}

const isFree = async (slot: Date, settings: Settings) =>
  (await db.serviceJob.count({ where: { appointmentDate: slot, status: { not: "CANCELLED" } } })) < (Number(settings.booking_slot_capacity) || 0);

async function offerSlots(customer: Customer, settings: Settings, vehicleId: string, serviceType: string, prefix = "") {
  const free: Date[] = [];
  for (const slot of slotTimes(settings)) {
    if (free.length === MAX_OFFERED) break;
    if (await isFree(slot, settings)) free.push(slot);
  }
  if (free.length === 0) {
    await setPending(customer.id, null);
    return `Sorry, we have no free slots right now.${settings.center_phone ? ` Please call us on ${settings.center_phone}.` : " Please reply here and our team will help."}`;
  }
  await setPending(customer.id, { intent: "BOOK", stage: "SLOT", vehicleId, serviceType, slots: free.map((s) => s.toISOString()) });
  return `${prefix}Choose a time for ${serviceType}:\n\n${numbered(free.map(dateTime))}\n\nReply with the number, or CANCEL to stop.`;
}

async function offerServices(customer: Customer, settings: Settings, vehicleId: string) {
  const types = await db.serviceType.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 20 });
  if (types.length === 0) return offerSlots(customer, settings, vehicleId, "General Service");
  const names = types.map((t) => t.name);
  await setPending(customer.id, { intent: "BOOK", stage: "SERVICE", vehicleId, types: names });
  return `What does your car need?\n\n${numbered(names)}\n\nReply with the number, or CANCEL to stop.`;
}

/** Vehicles already in for service can't be booked again until that job ends. */
const bookableVehicles = (customerId: string) =>
  db.vehicle.findMany({
    where: { customerId, serviceJobs: { none: { status: { in: ACTIVE_STATUSES } } } },
    orderBy: { createdAt: "asc" },
  });

export async function startBooking(customer: Customer, settings: Settings): Promise<string> {
  const vehicles = await bookableVehicles(customer.id);
  if (vehicles.length === 1) return offerServices(customer, settings, vehicles[0].id);
  if (vehicles.length > 1) {
    await setPending(customer.id, { intent: "BOOK", stage: "VEHICLE", vehicleIds: vehicles.map((v) => v.id) });
    return `Which vehicle would you like to book?\n\n${numbered(vehicles.map((v) => `${v.brand} ${v.model} — ${v.registrationNumber}`))}\n\nReply with the number, or CANCEL to stop.`;
  }
  const known = await db.vehicle.count({ where: { customerId: customer.id } });
  if (known > 0) return "Your vehicle is already booked in with us. Send STATUS to see how it's going.";
  return "We'd love to help! Please send your car's brand, model and registration number, and our team will book you in.";
}

/** Returns the next reply, or null when the message isn't an answer, so ordinary chat isn't interrupted. */
export async function continueBooking(customer: Customer, pending: BookingPending, text: string, settings: Settings): Promise<{ reply: string; jobId?: string } | null> {
  const trimmed = text.trim();
  if (/^(cancel|stop)$/i.test(trimmed)) {
    await setPending(customer.id, null);
    return { reply: "No problem, booking stopped. Send BOOK any time to start again." };
  }
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const index = Number(trimmed) - 1;
  const size = pending.stage === "VEHICLE" ? pending.vehicleIds.length : pending.stage === "SERVICE" ? pending.types.length : pending.slots.length;
  if (index < 0 || index >= size) return { reply: `Please reply with a number from 1 to ${size}, or CANCEL to stop.` };

  if (pending.stage === "VEHICLE") return { reply: await offerServices(customer, settings, pending.vehicleIds[index]) };
  if (pending.stage === "SERVICE") return { reply: await offerSlots(customer, settings, pending.vehicleId, pending.types[index]) };

  // Everything is checked again here: the list may be hours old and others may have booked since.
  const bookable = await bookableVehicles(customer.id);
  if (!bookable.some((v) => v.id === pending.vehicleId)) {
    await setPending(customer.id, null);
    return { reply: "Your vehicle is already booked in with us. Send STATUS to see how it's going." };
  }
  const slot = new Date(pending.slots[index]);
  const stillOffered = slotTimes(settings).some((s) => s.getTime() === slot.getTime());
  if (!stillOffered || !(await isFree(slot, settings))) {
    return { reply: await offerSlots(customer, settings, pending.vehicleId, pending.serviceType, "Sorry, that time has just gone.\n\n") };
  }

  await setPending(customer.id, null);
  const job = await createJob(
    { ...SYSTEM_ACTOR, name: "WhatsApp" },
    {
      customerId: customer.id,
      vehicleId: pending.vehicleId,
      serviceType: pending.serviceType,
      customerComplaint: null,
      internalNotes: "Booked by the customer on WhatsApp",
      appointmentDate: slot,
      estimatedAmount: null,
      expectedCompletion: null,
    },
  );
  return {
    jobId: job.id,
    reply: `You're booked for ${pending.serviceType} on ${dateTime(slot)}.\nYour service ID is ${job.serviceNumber}.\nTrack it here: ${trackingUrl(job.trackingToken)}`,
  };
}
