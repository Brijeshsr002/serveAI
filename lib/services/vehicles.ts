import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import { db, isUniqueViolation, nextVehicleCode } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { normalizeRegistration } from "@/lib/phone";

const optionalText = z.string().trim().max(120).optional().nullable().transform((v) => v || null);
const optionalInt = (min: number, max: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
    .pipe(z.number().int().min(min).max(max).nullable());

const vehicleFields = {
  registrationNumber: z.string().trim().min(4, "Registration number is required").max(20),
  brand: z.string().trim().min(1, "Brand is required").max(60),
  model: z.string().trim().min(1, "Model is required").max(60),
  variant: optionalText,
  manufacturingYear: optionalInt(1950, 2100),
  fuelType: optionalText,
  color: optionalText,
  odometer: optionalInt(0, 5_000_000),
};

export const vehicleSchema = z.object({ customerId: z.string().min(1), ...vehicleFields });
export const vehiclePatchSchema = z.object(vehicleFields).partial();

export async function createVehicle(actor: Actor, input: z.output<typeof vehicleSchema>) {
  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  try {
    const vehicle = await db.vehicle.create({
      data: {
        ...input,
        registrationNumber: normalizeRegistration(input.registrationNumber),
        vehicleCode: await nextVehicleCode(),
      },
    });
    await logActivity(actor, {
      action: "VEHICLE_CREATED",
      entityType: "Vehicle",
      entityId: vehicle.id,
      summary: `${actor.name} added vehicle ${vehicle.registrationNumber} for ${customer.name}`,
    });
    return vehicle;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("DUPLICATE_REGISTRATION", "This registration number already exists");
    throw err;
  }
}

export async function updateVehicle(actor: Actor, id: string, input: z.output<typeof vehiclePatchSchema>) {
  try {
    const vehicle = await db.vehicle.update({
      where: { id },
      data: {
        ...input,
        ...(input.registrationNumber ? { registrationNumber: normalizeRegistration(input.registrationNumber) } : {}),
      },
    });
    await logActivity(actor, {
      action: "VEHICLE_UPDATED",
      entityType: "Vehicle",
      entityId: id,
      summary: `${actor.name} updated vehicle ${vehicle.registrationNumber}`,
    });
    return vehicle;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("DUPLICATE_REGISTRATION", "This registration number already exists");
    throw err;
  }
}
