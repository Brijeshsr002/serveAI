import { randomBytes } from "node:crypto";
import { Prisma, Priority, ServiceStatus } from "@prisma/client";
import { z } from "zod";
import { logActivity, SYSTEM_ACTOR } from "@/lib/activity";
import type { Actor } from "@/lib/api/route";
import type { SessionUser } from "@/lib/auth/session";
import { db, lockUserRow, nextServiceNumber, type Tx } from "@/lib/db";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { dateToDayKey, dayKeyToDate, istDayKey } from "@/lib/format";
import { loadJobContext, NotificationService } from "@/lib/notifications";
import { PaymentService } from "@/lib/payments";
import { generateInvoiceIfNeeded } from "@/lib/services/invoices";
import { defaultRate } from "@/lib/services/service-rates";
import { ACTIVE_STATUSES, boardTargets, isTerminal, STATUS_LABEL, TRANSITIONS } from "@/lib/status";

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
  // An enquiry with no quote starts from the service's default price.
  const estimatedAmount = fields.estimatedAmount ?? (await defaultRate(fields.serviceType));

  const job = await db.$transaction(async (tx) => {
    const created = await tx.serviceJob.create({
      data: {
        ...fields,
        estimatedAmount,
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
  return (await autoAssignNewJob(job)) ?? job;
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

const isActiveWorker = (u: { role: string; active: boolean } | null) => u?.role === "WORKER" && u.active;

/** Locked, so a role change or deactivation can't commit between this read and the job being saved. */
async function lockedStaff(tx: Tx, id: string) {
  await lockUserRow(tx, id);
  return tx.user.findUnique({ where: { id }, select: { name: true, role: true, active: true } });
}

/** `silent` keeps the customer out of it; `reason` goes on the logged move. */
export async function assignWorker(actor: Actor, jobId: string, workerId: string, opts: { silent?: boolean; reason?: string } = {}) {
  const worker = await db.user.findUnique({ where: { id: workerId }, select: { id: true, name: true, role: true, active: true } });
  if (!worker || worker.role !== "WORKER" || !worker.active) {
    throw badRequest("INVALID_WORKER", "Select an active worker");
  }
  const job = await db.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) throw notFound("SERVICE_NOT_FOUND", "Service job not found");
  if (isTerminal(job.status)) throw conflict("SERVICE_CLOSED", "This service job is already closed");
  if (job.assignedWorkerId === workerId) throw conflict("ALREADY_ASSIGNED", `Already assigned to ${worker.name}`);

  const firstAssignment = job.status === "NEW";
  const updated = await db.$transaction(async (tx) => {
    if (!isActiveWorker(await lockedStaff(tx, workerId))) throw badRequest("INVALID_WORKER", "Select an active worker");
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
        summary: `${actor.name} ${job.assignedWorkerId ? "reassigned" : "assigned"} ${job.serviceNumber} to ${worker.name}${opts.reason ? ` (${opts.reason})` : ""}`,
        metadata: { workerId, previousWorkerId: job.assignedWorkerId },
      },
      tx,
    );
    return result;
  });

  if (firstAssignment && !opts.silent) {
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

  if (override) {
    if (user.role !== "ADMIN") throw forbidden("Only an admin can override status rules");
    if (!notes?.trim()) throw badRequest("OVERRIDE_REASON_REQUIRED", "Give a reason for the override");
    return;
  }
  if (!boardTargets(job.status).includes(next)) throw invalidTransition(job.status, next);
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

  const override = Boolean(input.override);
  assertStatusChangeAllowed(user, job, input.status, override, input.notes);

  let next = input.status;
  await db.$transaction(async (tx) => {
    // Reopening a closed job for someone who has since left the workers would leave it where nobody can work it or
    // see it. A closed job can't be reassigned first, so it goes back to New with nobody on it.
    let notes = input.notes;
    let unassign = false;
    if (isTerminal(job.status) && !isTerminal(next) && job.assignedWorkerId) {
      const holder = await lockedStaff(tx, job.assignedWorkerId);
      if (!isActiveWorker(holder)) {
        unassign = true;
        next = "NEW";
        const why = `${holder?.name ?? "The last worker"} is no longer an active worker, so the job went back to New to be assigned`;
        notes = notes ? `${notes} (${why})` : why;
      }
    }
    // Matching on the old status makes two simultaneous clicks produce one change, not two.
    const { count } = await tx.serviceJob.updateMany({
      where: { id: jobId, status: job.status },
      data: { status: next, actualCompletion: next === "COMPLETED" ? new Date() : null, ...(unassign ? { assignedWorkerId: null } : {}) },
    });
    if (count === 0) throw conflict("STATUS_CONFLICT", "This job was just updated by someone else. Refresh and retry.");
    await tx.serviceStatusHistory.create({
      data: {
        serviceJobId: jobId,
        oldStatus: job.status,
        newStatus: next,
        changedById: actor.id,
        changedByRole: actor.role,
        notes,
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
        metadata: { from: job.status, to: next, notes: notes ?? null },
      },
      tx,
    );
  });

  // A closed job can't take new work, and a cancelled one can't be paid for.
  if (isTerminal(next)) await db.serviceItem.updateMany({ where: { serviceJobId: jobId, approval: "PENDING" }, data: { approval: "DECLINED" } });
  if (next === "CANCELLED") {
    const open = await db.payment.findFirst({ where: { serviceJobId: jobId, status: { in: ["PENDING", "PROCESSING"] } } });
    if (open) await PaymentService.cancelOpenPayment(open.id, open.paymentProvider, open.paymentOrderId);
  }

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

/**
 * What a worker's job API responses may hold. The tracking token is the customer's own key to
 * approve work and pay, so it and payment links stay with staff.
 */
export function hideFromWorker<T extends { trackingToken: string; payments?: { paymentLink: string | null }[] }>(job: T) {
  const { trackingToken: _hidden, ...rest } = job;
  return { ...rest, ...(job.payments ? { payments: job.payments.map((p) => ({ ...p, paymentLink: null })) } : {}) };
}

/** Workers with their current load, leave and start date on the given IST day (today by default), for the assign dropdown. startsOn is set only for someone who hasn't started by then. */
export async function workersWithLoad(dayKey = istDayKey(new Date())) {
  const day = dayKeyToDate(dayKey);
  const workers = await db.user.findMany({
    where: { role: "WORKER", active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      joinedOn: true,
      _count: { select: { assignedJobs: { where: { status: { in: ACTIVE_STATUSES } } } } },
      attendance: { where: { date: day, status: "LEAVE" }, select: { id: true } },
    },
  });
  return workers.map((w) => {
    const joined = w.joinedOn && dateToDayKey(w.joinedOn);
    return { id: w.id, name: w.name, activeJobs: w._count.assignedJobs, onLeave: w.attendance.length > 0, startsOn: joined && joined > dayKey ? joined : null };
  });
}

const AUTO_ACTOR: Actor = { ...SYSTEM_ACTOR, name: "Auto-assign" };

const autoAssignOn = async () => (await db.setting.findUnique({ where: { key: "auto_assign_enabled" } }))?.value === "true";

/** Who can take work on that day, so nobody on leave or not started yet: fewest active jobs first, then by name so ties always go the same way. */
const availableWorkers = async (dayKey?: string) =>
  (await workersWithLoad(dayKey))
    .filter((w) => !w.onLeave && !w.startsOn)
    .sort((a, b) => a.activeJobs - b.activeJobs || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

/** A failure here must not lose the job that was just created, so it only logs. Returns null when nothing was assigned. */
async function autoAssignNewJob(job: { id: string; serviceNumber: string; appointmentDate: Date | null }) {
  try {
    if (!(await autoAssignOn())) return null;
    // A booking needs someone who is in on the day of the booking. Day keys sort as dates.
    const today = istDayKey(new Date());
    const booked = job.appointmentDate ? istDayKey(job.appointmentDate) : today;
    const day = booked > today ? booked : today;
    const [next] = await availableWorkers(day);
    if (next) return await assignWorker(AUTO_ACTOR, job.id, next.id);
    await logActivity(AUTO_ACTOR, {
      action: "AUTO_ASSIGN_SKIPPED",
      entityType: "ServiceJob",
      entityId: job.id,
      summary: `No worker is available ${day === today ? "today" : `on ${day}`}, so ${job.serviceNumber} was left unassigned`,
    });
  } catch (err) {
    console.error("Auto-assign failed:", (err as Error).message);
  }
  return null;
}

/** Moves a worker's open jobs one at a time to whoever has the fewest. Customers aren't told about a reassignment. */
export async function redistributeLeave(worker: { id: string; name: string }) {
  if (!(await autoAssignOn())) return;
  const jobs = await db.serviceJob.findMany({
    where: { assignedWorkerId: worker.id, status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: "asc" },
    select: { id: true, serviceNumber: true },
  });
  if (jobs.length === 0) return;
  const pool = await availableWorkers();
  if (pool.length === 0) {
    await logActivity(AUTO_ACTOR, {
      action: "AUTO_ASSIGN_SKIPPED",
      entityType: "User",
      entityId: worker.id,
      summary: `${worker.name} is on leave and no other worker is available, so ${jobs.length} job${jobs.length === 1 ? "" : "s"} stayed with them`,
    });
    return;
  }
  for (const job of jobs) {
    const next = pool.reduce((least, w) => (w.activeJobs < least.activeJobs ? w : least));
    try {
      await assignWorker(AUTO_ACTOR, job.id, next.id, { silent: true, reason: `${worker.name} is on leave` });
      next.activeJobs++;
    } catch (err) {
      await logActivity(AUTO_ACTOR, {
        action: "AUTO_ASSIGN_FAILED",
        entityType: "ServiceJob",
        entityId: job.id,
        summary: `Couldn't move ${job.serviceNumber} off ${worker.name}: ${(err as Error).message}`,
      });
    }
  }
}
