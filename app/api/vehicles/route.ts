import { authed, ok } from "@/lib/api/route";
import { db } from "@/lib/db";
import { STAFF } from "@/lib/permissions";
import { normalizeRegistration } from "@/lib/phone";
import { createVehicle, vehicleSchema } from "@/lib/services/vehicles";

export const GET = authed(STAFF, async ({ req }) => {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const customerId = req.nextUrl.searchParams.get("customerId");
  return db.vehicle.findMany({
    where: {
      ...(customerId ? { customerId } : {}),
      ...(q
        ? {
            OR: [
              { registrationNumber: { contains: normalizeRegistration(q) } },
              { brand: { contains: q, mode: "insensitive" as const } },
              { model: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
});

export const POST = authed(STAFF, async ({ actor, body }) => ok(await createVehicle(actor, await body(vehicleSchema)), 201));
