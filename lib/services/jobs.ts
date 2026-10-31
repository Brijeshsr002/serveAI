import { randomBytes } from "node:crypto";
import { Prisma, Priority, ServiceStatus } from "@prisma/client";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import type { SessionUser } from "@/lib/auth/session";
import { db, nextServiceNumber } from "@/lib/db";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { loadJobContext, NotificationService } from "@/lib/notifications";
import { generateInvoiceIfNeeded } from "@/lib/services/invoices";
import { ACTIVE_STATUSES, isTerminal, STATUS_LABEL, TRANSITIONS } from "@/lib/status";

export const newTrackingToken = () => randomBytes(32).toString("hex");

const optionalDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v ? new Date(v) : null))
  .refine((v) => v === null || !Number.isNaN(v.getTime()), "Invalid date");

const optionalAmount = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
  .pipe(z.number().min(0).max(100_000_000).nullable());

const optionalLongText = z.string().trim().max(5000).optional().nullable().transform((v) => v || null);

const jobFields = {
  serviceType: z.string().trim().min(1, "Service type is required").max(120),
  customerComplaint: optionalLongText,
  internalNotes: optionalLongText,
  estimatedAmount: optionalAmount,
  priority: z.enum(Priority).optional(),
  appointmentDate: optionalDate,
  expectedCompletion: optionalDate,
};

export const jobSchema = z.object({
  customerId: z.string().min(1),
  vehicleId: z.string().min(1),
  assignedWorkerId: z.string().optional().nullable(),
  ...jobFields,
});
export const jobPatchSchema = z.object(jobFields).partial();
export const assignSchema = z.object({ workerId: z.string().min(1) });
export const statusSchema = z.object({
  status: z.enum(ServiceStatus),
  notes: z.string().trim().max(1000).optional(),
  override: z.boolean().optional(),
});

type JobCreate = z.output<typeof jobSchema>;

export async function createJob(actor: Actor, input: JobCreate, externalRef?: string, notifyCustomer = false) {
  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle || vehicle.customerId !== input.customerId) {
    throw badRequest("VEHICLE_CUSTOMER_MISMATCH", "This vehicle does not belong to the selected customer");
  }
  const { assignedWorkerId, ...fields } = input;

  const job = await db.$transaction(async (tx) => {
    const created = await tx.serviceJob.create({
      data: {
        ...fields,
        serviceNumber: await nextServiceNumber(tx),
        trackingToken: newTrackingToken(),
        createdById: actor.id,
        externalRef: externalRef ?? null,
        status: "NEW",
      },
    });
    await tx.serviceStatusHistory.create({
      data: {
        serviceJobId: created.id,
        oldStatus: null,
        newStatus: "NEW",
        changedById: actor.id,
        changedByRole: actor.role,
        notes: "Service created",
      },
    });
    await logActivity(
      actor,
      {
        action: "SERVICE_CREATED",
        entityType: "ServiceJob",
        entityId: created.id,
        summary: `${actor.name} created service ${created.serviceNumber}`,
      },
      tx,
    );
    return created;
  });

  if (notifyCustomer) await NotificationService.sendServiceRequestReceived(await loadJobContext(job.id));
  if (assignedWorkerId) return assignWorker(actor, job.id, assignedWorkerId);
  return job;
}

export async function updateJob(actor: Actor, id: string, input: z.output<typeof jobPatchSchema>) {
  const job = await db.serviceJob.update({ where: { id }, data: input });
  await logActivity(actor, {
    action: "SERVICE_UPDATED",
    entityType: "ServiceJob",
    entityId: id,
    summary: `${actor.name} updated service ${job.serviceNumber}`,
  });
  return job;
}

export async function assignWorker(actor: Actor, jobId: string, workerId: string) {
  const worker = await db.user.findUnique({ where: { id: workerId } });
  if (!worker || worker.role !== "WORKER" || !worker.active) {
    throw badRequest("INVALID_WORKER", "Select an active worker");
  }
  const job = await db.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) throw notFound("SERVICE_NOT_FOUND", "Service job not found");
  if (isTerminal(job.status)) throw conflict("SERVICE_CLOSED", "This service job is already closed");
  if (job.assignedWorkerId === workerId) throw conflict("ALREADY_ASSIGNED", `Already assigned to ${worker.name}`);

  const firstAssignment = job.status === "NEW";
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.serviceJob.update({
      where: { id: jobId },
      data: { assignedWorkerId: workerId, status: firstAssignment ? "ASSIGNED" : undefined },
    });
    if (firstAssignment) {
      await tx.serviceStatusHistory.create({
        data: {
          serviceJobId: jobId,
          oldStatus: "NEW",
          newStatus: "ASSIGNED",
          changedById: actor.id,
          changedByRole: actor.role,
          notes: `Assigned to ${worker.name}`,
        },
      });
    }
    await logActivity(
      actor,
      {
        action: job.assignedWorkerId ? "SERVICE_REASSIGNED" : "SERVICE_ASSIGNED",
        entityType: "ServiceJob",
        entityId: jobId,
        summary: `${actor.name} ${job.assignedWorkerId ? "reassigned" : "assigned"} ${job.serviceNumber} to ${worker.name}`,
        metadata: { workerId, previousWorkerId: job.assignedWorkerId },
      },
      tx,
    );
    return result;
  });

  if (firstAssignment) {
    await NotificationService.sendServiceStatusUpdate(await loadJobContext(jobId), "ASSIGNED");
  }
  return updated;
}

export function assertStatusChangeAllowed(
  user: Pick<SessionUser, "id" | "role">,
  job: { status: ServiceStatus; assignedWorkerId: string | null },
  next: ServiceStatus,
  override: boolean,
  notes?: string,
) {
  if (job.status === next) throw conflict("STATUS_UNCHANGED", "The job already has this status");

  if (user.role === "WORKER") {
    // 404, not 403: a worker should not learn that someone else's job exists.
    if (job.assignedWorkerId !== user.id) throw notFound("SERVICE_NOT_FOUND", "Service job not found");
    if (override) throw forbidden("Only an admin can override status rules");
    if (next === "ASSIGNED" || next === "CANCELLED" || !TRANSITIONS[job.status].includes(next)) {
      throw invalidTransition(job.status, next);
    }
    return;
  }

  if (user.role === "RECEPTIONIST") {
    if (override) throw forbidden("Only an admin can override status rules");
    if (next !== "CANCELLED") throw forbidden("Status is updated by the assigned worker");
    if (isTerminal(job.status)) throw invalidTransition(job.status, next);
    return;
  }

  if (override) {
    if (!notes?.trim()) throw badRequest("OVERRIDE_REASON_REQUIRED", "Give a reason for the override");
    return;
  }
  const allowed = next === "CANCELLED" ? !isTerminal(job.status) : next !== "ASSIGNED" && TRANSITIONS[job.status].includes(next);
  if (!allowed) throw invalidTransition(job.status, next);
}

const invalidTransition = (from: ServiceStatus, to: ServiceStatus) =>
  new ApiError(422, "INVALID_STATUS_TRANSITION", `Cannot move from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}`);

export async function changeStatus(
  user: Pick<SessionUser, "id" | "role">,
  actor: Actor,
  jobId: string,
  input: z.output<typeof statusSchema>,
) {
  const job = await db.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) throw notFound("SERVICE_NOT_FOUND", "Service job not found");

  const next = input.status;
  const override = Boolean(input.override);
  assertStatusChangeAllowed(user, job, next, override, input.notes);

  await db.$transaction(async (tx) => {
    // Matching on the old status makes two simultaneous clicks produce one change, not two.
    const { count } = await tx.serviceJob.updateMany({
      where: { id: jobId, status: job.status },
      data: { status: next, actualCompletion: next === "COMPLETED" ? new Date() : undefined },
    });
    if (count === 0) throw conflict("STATUS_CONFLICT", "This job was just updated by someone else. Refresh and retry.");
    await tx.serviceStatusHistory.create({
      data: {
        serviceJobId: jobId,
        oldStatus: job.status,
        newStatus: next,
        changedById: actor.id,
        changedByRole: actor.role,
        notes: input.notes,
        isOverride: override,
      },
    });
    await logActivity(
      actor,
      {
        action: override ? "STATUS_OVERRIDE" : "STATUS_CHANGED",
        entityType: "ServiceJob",
        entityId: jobId,
        summary: `${actor.name} changed ${job.serviceNumber} from ${STATUS_LABEL[job.status]} to ${STATUS_LABEL[next]}${override ? " (override)" : ""}`,
        metadata: { from: job.status, to: next, notes: input.notes ?? null },
      },
      tx,
    );
  });

  let finalAmount: Prisma.Decimal | null = null;
  if (next === "READY_FOR_DELIVERY" || next === "COMPLETED") {
    const invoice = await generateInvoiceIfNeeded(actor, jobId);
    finalAmount = invoice?.total ?? null;
  }
  await NotificationService.sendServiceStatusUpdate(await loadJobContext(jobId), next, finalAmount);
  return db.serviceJob.findUniqueOrThrow({ where: { id: jobId } });
}

/** Scope filter used by every job read: workers only ever see their own. */
export const jobScope = (user: Pick<SessionUser, "id" | "role">): Prisma.ServiceJobWhereInput =>
  user.role === "WORKER" ? { assignedWorkerId: user.id } : {};

export async function getJobForUser(user: Pick<SessionUser, "id" | "role">, id: string) {
  const job = await db.serviceJob.findFirst({
    where: { id, ...jobScope(user) },
    include: {
      customer: true,
      vehicle: true,
      assignedWorker: { select: { id: true, name: true } },
      statusHistory: { orderBy: { createdAt: "asc" }, include: { changedBy: { select: { name: true } } } },
      items: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "desc" } },
      invoice: true,
    },
  });
  if (!job) throw notFound("SERVICE_NOT_FOUND", "Service job not found");
  return job;
}

/** Workers with their current load, for the assign dropdown. */
export async function workersWithLoad() {
  const workers = await db.user.findMany({
    where: { role: "WORKER", active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      _count: { select: { assignedJobs: { where: { status: { in: ACTIVE_STATUSES } } } } },
    },
  });
  return workers.map((w) => ({ id: w.id, name: w.name, activeJobs: w._count.assignedJobs }));
}
