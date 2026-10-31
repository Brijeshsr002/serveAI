import { db } from "@/lib/db";
import { addDays, istDayKey, istMonthKey, startOfDayIST, toNumber } from "@/lib/format";
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

export async function chartData() {
  const today = startOfDayIST();
  const dailyStart = addDays(today, -13);
  const monthlyStart = addDays(today, -365);

  const [byStatus, byType, paid, performance, workers] = await Promise.all([
    db.serviceJob.groupBy({ by: ["status"], _count: true }),
    db.serviceJob.groupBy({ by: ["serviceType"], _count: true, orderBy: { _count: { serviceType: "desc" } }, take: 8 }),
    db.payment.findMany({ where: { status: "PAID", paidAt: { gte: monthlyStart } }, select: { amount: true, paidAt: true } }),
    db.serviceJob.groupBy({ by: ["assignedWorkerId", "status"], where: { assignedWorkerId: { not: null } }, _count: true }),
    db.user.findMany({ where: { role: "WORKER" }, select: { id: true, name: true } }),
  ]);

  const daily = new Map<string, number>();
  for (let i = 0; i < 14; i++) daily.set(istDayKey(addDays(dailyStart, i)), 0);
  const monthly = new Map<string, number>();
  for (const p of paid) {
    if (!p.paidAt) continue;
    const day = istDayKey(p.paidAt);
    if (daily.has(day)) daily.set(day, daily.get(day)! + toNumber(p.amount));
    const month = istMonthKey(p.paidAt);
    monthly.set(month, (monthly.get(month) ?? 0) + toNumber(p.amount));
  }

  return {
    byStatus: STATUSES.map((s) => ({
      name: STATUS_LABEL[s],
      status: s,
      value: byStatus.find((b) => b.status === s)?._count ?? 0,
    })),
    byType: byType.map((t) => ({ name: t.serviceType, value: t._count })),
    dailyRevenue: [...daily].map(([day, value]) => ({ name: day.slice(5), value })),
    monthlyRevenue: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ name, value })),
    workerPerformance: workers.map((w) => {
      const rows = performance.filter((p) => p.assignedWorkerId === w.id);
      const count = (pred: (s: (typeof rows)[number]) => boolean) => rows.filter(pred).reduce((n, r) => n + r._count, 0);
      return {
        name: w.name,
        completed: count((r) => r.status === "COMPLETED"),
        active: count((r) => ACTIVE_STATUSES.includes(r.status)),
      };
    }),
  };
}

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
