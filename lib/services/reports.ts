import type { Prisma, ServiceStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { addDayKey, addDays, dateTime, isDayKey, istDayKey, istMonthKey, money, monthRangeIST, startOfDayIST, toNumber } from "@/lib/format";
import { ACTIVE_STATUSES, STATUS_LABEL, STATUSES } from "@/lib/status";

export async function dashboardStats() {
  const today = startOfDayIST();
  const tomorrow = addDays(today, 1);
  const [customers, todayServices, activeServices, completedToday, pendingPayments, revenue] = await Promise.all([
    db.customer.count(),
    db.serviceJob.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
    db.serviceJob.count({ where: { status: { in: ACTIVE_STATUSES } } }),
    db.serviceJob.count({ where: { status: "COMPLETED", actualCompletion: { gte: today, lt: tomorrow } } }),
    db.payment.aggregate({ where: { status: "PENDING" }, _count: true, _sum: { amount: true } }),
    db.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
  ]);
  const vehiclesInService = await db.serviceJob.count({
    where: { status: { in: ["VEHICLE_RECEIVED", "INSPECTION", "SERVICE_IN_PROGRESS", "WAITING_FOR_PARTS", "READY_FOR_DELIVERY"] } },
  });
  return {
    customers,
    todayServices,
    activeServices,
    completedToday,
    pendingPayments: pendingPayments._count,
    pendingAmount: toNumber(pendingPayments._sum.amount),
    revenue: toNumber(revenue._sum.amount),
    vehiclesInService,
  };
}

/** Everyone with a bar on the worker chart. Someone moved to reception keeps theirs, because the jobs they did still count. */
const hasWorkerRecord: Prisma.UserWhereInput = { OR: [{ role: "WORKER" }, { assignedJobs: { some: {} } }] };

const dayFormat = (options: Intl.DateTimeFormatOptions, key: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...options }).format(new Date(`${key}T12:00:00+05:30`));

export async function chartData() {
  const today = startOfDayIST();
  const dailyStart = addDays(today, -13);
  // From the first of the month, so the oldest bar is a whole month and matches its drilldown.
  const monthlyStart = monthRangeIST(istMonthKey(addDays(today, -365))).start;

  const [byStatus, byType, paid, performance, workers] = await Promise.all([
    db.serviceJob.groupBy({ by: ["status"], _count: true }),
    db.serviceJob.groupBy({ by: ["serviceType"], _count: true, orderBy: { _count: { serviceType: "desc" } }, take: 8 }),
    db.payment.findMany({ where: { status: "PAID", paidAt: { gte: monthlyStart } }, select: { amount: true, paidAt: true } }),
    db.serviceJob.groupBy({ by: ["assignedWorkerId", "status"], where: { assignedWorkerId: { not: null } }, _count: true }),
    db.user.findMany({ where: hasWorkerRecord, select: { id: true, name: true } }),
  ]);

  const daily = new Map<string, number>();
  for (let i = 0; i < 14; i++) daily.set(istDayKey(addDays(dailyStart, i)), 0);
  const monthly = new Map<string, number>();
  for (const p of paid) {
    if (!p.paidAt) continue;
    const day = istDayKey(p.paidAt);
    if (daily.has(day)) daily.set(day, daily.get(day)! + Math.round(toNumber(p.amount) * 100));
    const month = istMonthKey(p.paidAt);
    monthly.set(month, (monthly.get(month) ?? 0) + Math.round(toNumber(p.amount) * 100));
  }

  return {
    byStatus: STATUSES.map((s) => ({
      name: STATUS_LABEL[s],
      status: s,
      key: s,
      value: byStatus.find((b) => b.status === s)?._count ?? 0,
    })),
    byType: byType.map((t) => ({ name: t.serviceType, key: t.serviceType, value: t._count })),
    dailyRevenue: [...daily].map(([day, paise]) => ({
      name: dayFormat({ day: "numeric", month: "short" }, day),
      full: dayFormat({ weekday: "short", day: "numeric", month: "long", year: "numeric" }, day),
      key: day,
      value: paise / 100,
    })),
    monthlyRevenue: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([month, paise]) => ({
      name: dayFormat({ month: "short", year: "numeric" }, `${month}-15`),
      full: dayFormat({ month: "long", year: "numeric" }, `${month}-15`),
      key: month,
      value: paise / 100,
    })),
    workerPerformance: workers.map((w) => {
      const rows = performance.filter((p) => p.assignedWorkerId === w.id);
      const count = (pred: (s: (typeof rows)[number]) => boolean) => rows.filter(pred).reduce((n, r) => n + r._count, 0);
      return {
        name: w.name,
        key: w.id,
        completed: count((r) => r.status === "COMPLETED"),
        active: count((r) => ACTIVE_STATUSES.includes(r.status)),
      };
    }),
  };
}

const WORKER_BUCKETS = {
  completed: { label: "completed jobs", where: { status: "COMPLETED" } },
  active: { label: "active jobs", where: { status: { in: ACTIVE_STATUSES } } },
  all: { label: "jobs", where: {} },
} satisfies Record<string, { label: string; where: Prisma.ServiceJobWhereInput }>;

/** What one chart bar or row stands for. */
export const drilldownSchema = z
  .object({
    kind: z.enum(["status", "type", "day", "month", "worker"]),
    value: z.string().trim().min(1).max(120),
    bucket: z.enum(["all", "completed", "active"]).default("all"),
  })
  .superRefine(({ kind, value }, ctx) => {
    const valid = kind === "status" ? STATUSES.includes(value as ServiceStatus) : kind === "day" ? isDayKey(value) : kind === "month" ? /^\d{4}-(0[1-9]|1[0-2])$/.test(value) : true;
    if (!valid) ctx.addIssue({ code: "custom", path: ["value"], message: `Not a valid ${kind}` });
  });

const DRILLDOWN_LIMIT = 500;

/** Counts and totals come from the same filters as chartData over every matching row, so they equal the bar even when the list is capped. */
export async function drilldown({ kind, value, bucket }: z.output<typeof drilldownSchema>) {
  if (kind === "day" || kind === "month") {
    const range = kind === "day" ? { start: new Date(`${value}T00:00:00+05:30`), end: new Date(`${addDayKey(value, 1)}T00:00:00+05:30`) } : monthRangeIST(value);
    const where: Prisma.PaymentWhereInput = { status: "PAID", paidAt: { gte: range.start, lt: range.end } };
    const [rows, totals] = await Promise.all([
      db.payment.findMany({
        where,
        orderBy: { paidAt: "asc" },
        take: DRILLDOWN_LIMIT,
        include: { customer: { select: { name: true, phone: true } }, serviceJob: { select: { id: true, serviceNumber: true, serviceType: true } } },
      }),
      db.payment.aggregate({ where, _count: true, _sum: { amount: true } }),
    ]);
    const total = toNumber(totals._sum.amount);
    return {
      type: "payments" as const,
      title: `Revenue for ${kind === "day" ? dayFormat({ weekday: "short", day: "numeric", month: "long", year: "numeric" }, value) : dayFormat({ month: "long", year: "numeric" }, `${value}-15`)}`,
      count: totals._count,
      total,
      totalLabel: money(total),
      rows: rows.map((p) => ({
        id: p.id,
        jobId: p.serviceJob.id,
        serviceNumber: p.serviceJob.serviceNumber,
        serviceType: p.serviceJob.serviceType,
        customerName: p.customer.name,
        phone: p.customer.phone,
        amount: money(p.amount),
        provider: p.paymentProvider,
        paidAt: dateTime(p.paidAt),
      })),
    };
  }

  let title: string;
  let where: Prisma.ServiceJobWhereInput;
  if (kind === "status") {
    title = `${STATUS_LABEL[value as ServiceStatus]} services`;
    where = { status: value as ServiceStatus };
  } else if (kind === "type") {
    title = `${value} services`;
    where = { serviceType: value };
  } else {
    const worker = await db.user.findFirst({ where: { id: value, ...hasWorkerRecord }, select: { name: true } });
    if (!worker) throw notFound("WORKER_NOT_FOUND", "Worker not found");
    title = `${worker.name}'s ${WORKER_BUCKETS[bucket].label}`;
    where = { assignedWorkerId: value, ...WORKER_BUCKETS[bucket].where };
  }
  const [rows, count] = await Promise.all([
    db.serviceJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: DRILLDOWN_LIMIT,
      include: {
        customer: { select: { name: true, phone: true } },
        vehicle: { select: { registrationNumber: true, brand: true, model: true } },
        assignedWorker: { select: { name: true } },
      },
    }),
    db.serviceJob.count({ where }),
  ]);
  return {
    type: "jobs" as const,
    title,
    count,
    rows: rows.map((j) => ({
      id: j.id,
      serviceNumber: j.serviceNumber,
      serviceType: j.serviceType,
      status: j.status,
      customerName: j.customer.name,
      phone: j.customer.phone,
      registrationNumber: j.vehicle.registrationNumber,
      vehicleName: `${j.vehicle.brand} ${j.vehicle.model}`,
      workerName: j.assignedWorker?.name ?? null,
      amount: money(j.finalAmount ?? j.estimatedAmount),
      created: dateTime(j.createdAt),
    })),
  };
}

export type Drilldown = Awaited<ReturnType<typeof drilldown>>;

export async function reportSummary() {
  const today = startOfDayIST();
  const count = (gte: Date) => db.serviceJob.count({ where: { createdAt: { gte } } });
  const [daily, weekly, monthly, completed, cancelled, repeat, paid, pending] = await Promise.all([
    count(today),
    count(addDays(today, -7)),
    count(addDays(today, -30)),
    db.serviceJob.count({ where: { status: "COMPLETED" } }),
    db.serviceJob.count({ where: { status: "CANCELLED" } }),
    db.serviceJob.groupBy({ by: ["customerId"], _count: true, having: { customerId: { _count: { gt: 1 } } } }),
    db.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { status: "PENDING" }, _sum: { amount: true } }),
  ]);
  return {
    daily,
    weekly,
    monthly,
    completed,
    cancelled,
    repeatCustomers: repeat.length,
    revenue: toNumber(paid._sum.amount),
    pendingAmount: toNumber(pending._sum.amount),
  };
}

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  // A leading =, +, - or @ would run as a formula when the file is opened in Excel.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const toCsv = (headers: string[], rows: unknown[][]) =>
  [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

export async function exportCsv(type: string): Promise<string | null> {
  if (type === "services") {
    const jobs = await db.serviceJob.findMany({
      orderBy: { createdAt: "desc" },
      include: { customer: true, vehicle: true, assignedWorker: { select: { name: true } } },
    });
    return toCsv(
      ["Service", "Created", "Customer", "Phone", "Registration", "Service type", "Status", "Worker", "Estimated", "Final"],
      jobs.map((j) => [j.serviceNumber, j.createdAt, j.customer.name, j.customer.phone, j.vehicle.registrationNumber, j.serviceType, j.status, j.assignedWorker?.name, j.estimatedAmount, j.finalAmount]),
    );
  }
  if (type === "payments") {
    const payments = await db.payment.findMany({
      orderBy: { createdAt: "desc" },
      include: { customer: true, serviceJob: { select: { serviceNumber: true } } },
    });
    return toCsv(
      ["Service", "Customer", "Amount", "Currency", "Provider", "Status", "Paid at", "Created"],
      payments.map((p) => [p.serviceJob.serviceNumber, p.customer.name, p.amount, p.currency, p.paymentProvider, p.status, p.paidAt, p.createdAt]),
    );
  }
  if (type === "workers") {
    const { workerPerformance } = await chartData();
    return toCsv(["Worker", "Completed", "Active"], workerPerformance.map((w) => [w.name, w.completed, w.active]));
  }
  return null;
}
