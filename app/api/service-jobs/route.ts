import { ServiceStatus } from "@prisma/client";
import { authed, ok } from "@/lib/api/route";
import { db } from "@/lib/db";
import { ALL_ROLES, STAFF } from "@/lib/permissions";
import { createJob, jobSchema, jobScope } from "@/lib/services/jobs";

export const GET = authed(ALL_ROLES, async ({ req, user }) => {
  const status = req.nextUrl.searchParams.get("status");
  const q = req.nextUrl.searchParams.get("q")?.trim();
  return db.serviceJob.findMany({
    where: {
      ...jobScope(user),
      ...(status && status in ServiceStatus ? { status: status as ServiceStatus } : {}),
      ...(q
        ? {
            OR: [
              { serviceNumber: { contains: q, mode: "insensitive" as const } },
              { customer: { name: { contains: q, mode: "insensitive" as const } } },
              { vehicle: { registrationNumber: { contains: q.toUpperCase().replace(/[^A-Z0-9]/g, "") } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, brand: true, model: true, registrationNumber: true } },
      assignedWorker: { select: { id: true, name: true } },
    },
  });
});

export const POST = authed(STAFF, async ({ actor, body }) => ok(await createJob(actor, await body(jobSchema)), 201));
