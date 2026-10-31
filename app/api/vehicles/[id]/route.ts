import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { STAFF } from "@/lib/permissions";
import { updateVehicle, vehiclePatchSchema } from "@/lib/services/vehicles";

export const GET = authed(STAFF, async ({ params }) => {
  const vehicle = await db.vehicle.findUnique({
    where: { id: params.id },
    include: { customer: true, serviceJobs: { orderBy: { createdAt: "desc" } } },
  });
  if (!vehicle) throw notFound("VEHICLE_NOT_FOUND", "Vehicle not found");
  return vehicle;
});

export const PATCH = authed(STAFF, async ({ actor, params, body }) =>
  updateVehicle(actor, params.id, await body(vehiclePatchSchema)),
);
