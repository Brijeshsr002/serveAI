// Development data only. Passwords are public (see README): never run this against production.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { ItemType, PrismaClient, ServiceStatus } from "@prisma/client";

const db = new PrismaClient();
export const DEV_PASSWORD = "ServeAI@123";

const pad = (n: number) => String(n).padStart(6, "0");
const YEAR = new Date().getFullYear();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

const CUSTOMERS = [
  ["Priya Raman", "Coimbatore"], ["Arun Kumar", "Coimbatore"], ["Divya Shankar", "Chennai"], ["Karthik Selvam", "Coimbatore"],
  ["Meena Iyer", "Bengaluru"], ["Vignesh Babu", "Coimbatore"], ["Lakshmi Narayan", "Tiruppur"], ["Suresh Pandian", "Madurai"],
  ["Anitha Joseph", "Coimbatore"], ["Rahul Menon", "Erode"],
];
const CARS = [
  ["Hyundai", "Creta"], ["Honda", "City"], ["Maruti Suzuki", "Baleno"], ["Tata", "Nexon"], ["Mahindra", "XUV700"],
  ["Toyota", "Innova Crysta"], ["Kia", "Seltos"], ["Hyundai", "i20"], ["Maruti Suzuki", "Swift"], ["Tata", "Punch"],
  ["Honda", "Amaze"], ["Renault", "Kiger"], ["Volkswagen", "Virtus"], ["Skoda", "Kushaq"], ["MG", "Hector"],
];
const SERVICE_TYPES = ["General Service", "Full Service", "AC Service", "Oil Change", "Brake Service", "Wheel Alignment", "Body Wash"];
const COMPLAINTS = ["Brake noise while stopping", "AC not cooling", "Periodic service due", "Engine oil warning light", "Steering pulls to the left", "Rattling from front suspension"];
const FLOW: ServiceStatus[] = ["NEW", "ASSIGNED", "VEHICLE_RECEIVED", "INSPECTION", "SERVICE_IN_PROGRESS", "READY_FOR_DELIVERY", "COMPLETED"];
// 20 jobs spread over every status so all dashboards have something to show.
const JOB_STATUSES: ServiceStatus[] = [
  "NEW", "NEW", "NEW", "ASSIGNED", "ASSIGNED", "VEHICLE_RECEIVED", "INSPECTION", "SERVICE_IN_PROGRESS", "SERVICE_IN_PROGRESS",
  "WAITING_FOR_PARTS", "READY_FOR_DELIVERY", "READY_FOR_DELIVERY", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED",
  "COMPLETED", "COMPLETED", "COMPLETED", "CANCELLED",
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  if ((await db.user.count()) > 0) {
    console.log("Database already has users; seed skipped.");
    return;
  }

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
  const user = (name: string, email: string, role: "ADMIN" | "RECEPTIONIST" | "WORKER", phone?: string) =>
    db.user.create({ data: { name, email, role, phone, passwordHash } });
  const admin = await user("Admin", "admin@serveai.local", "ADMIN");
  const reception = await user("Reception Desk", "reception@serveai.local", "RECEPTIONIST");
  const raj = await user("Raj", "worker1@serveai.local", "WORKER", "919000000101");
  const kumar = await user("Kumar", "worker2@serveai.local", "WORKER", "919000000102");
  const workers = [raj, kumar];

  await db.serviceType.createMany({ data: SERVICE_TYPES.map((name) => ({ name })) });

  const customers = [];
  for (let i = 0; i < CUSTOMERS.length; i++) {
    customers.push(
      await db.customer.create({
        data: {
          customerCode: `CUS-${pad(i + 1)}`,
          name: CUSTOMERS[i][0],
          city: CUSTOMERS[i][1],
          phone: `9198${String(76543210 + i * 1111)}`,
          email: `${CUSTOMERS[i][0].split(" ")[0].toLowerCase()}@example.com`,
        },
      }),
    );
  }

  const vehicles = [];
  for (let i = 0; i < CARS.length; i++) {
    vehicles.push(
      await db.vehicle.create({
        data: {
          vehicleCode: `VEH-${pad(i + 1)}`,
          customerId: customers[i % customers.length].id,
          registrationNumber: `TN38AB${1000 + i * 137}`,
          brand: CARS[i][0],
          model: CARS[i][1],
          manufacturingYear: 2018 + (i % 8),
          fuelType: i % 3 === 0 ? "Diesel" : "Petrol",
          odometer: 12000 + i * 3500,
        },
      }),
    );
  }

  let invoiceSeq = 0;
  for (let i = 0; i < JOB_STATUSES.length; i++) {
    const status = JOB_STATUSES[i];
    const vehicle = vehicles[i % vehicles.length];
    const assigned = status !== "NEW" && status !== "CANCELLED";
    const worker = assigned ? workers[i % 2] : null;
    // Finished jobs are spread back over two weeks to populate the revenue charts.
    const createdAt = status === "COMPLETED" ? hoursAgo(24 * (i - 11) + 30) : hoursAgo(2 + i * 3);

    const stops: ServiceStatus[] =
      status === "WAITING_FOR_PARTS"
        ? [...FLOW.slice(0, 5), "WAITING_FOR_PARTS"]
        : status === "CANCELLED"
          ? ["NEW", "CANCELLED"]
          : FLOW.slice(0, FLOW.indexOf(status) + 1);

    const job = await db.serviceJob.create({
      data: {
        serviceNumber: `SRV-${YEAR}-${pad(i + 1)}`,
        customerId: vehicle.customerId,
        vehicleId: vehicle.id,
        assignedWorkerId: worker?.id,
        createdById: reception.id,
        serviceType: SERVICE_TYPES[i % SERVICE_TYPES.length],
        customerComplaint: COMPLAINTS[i % COMPLAINTS.length],
        estimatedAmount: 2000 + i * 250,
        status,
        trackingToken: randomBytes(32).toString("hex"),
        createdAt,
        actualCompletion: status === "COMPLETED" ? new Date(createdAt.getTime() + 8 * 3_600_000) : null,
        statusHistory: {
          create: stops.map((s, n) => ({
            oldStatus: n === 0 ? null : stops[n - 1],
            newStatus: s,
            changedById: n <= 1 ? reception.id : (worker?.id ?? admin.id),
            changedByRole: n <= 1 ? "RECEPTIONIST" : "WORKER",
            createdAt: new Date(createdAt.getTime() + n * 3_600_000),
          })),
        },
      },
    });

    await db.activityLog.create({
      data: {
        userId: reception.id,
        actorRole: "RECEPTIONIST",
        action: "SERVICE_CREATED",
        entityType: "ServiceJob",
        entityId: job.id,
        summary: `Reception Desk created service ${job.serviceNumber}`,
        createdAt,
      },
    });

    if (status !== "READY_FOR_DELIVERY" && status !== "COMPLETED") continue;

    const lines: { itemType: ItemType; name: string; quantity: number; unitPrice: number }[] = [
      { itemType: "PART", name: "Engine Oil", quantity: 4, unitPrice: 500 },
      { itemType: "PART", name: "Oil Filter", quantity: 1, unitPrice: 500 },
      { itemType: "LABOUR", name: "Labour", quantity: 1, unitPrice: 1000 + i * 50 },
    ];
    const rows = lines.map((l) => ({ ...l, tax: 0, discount: 0, total: l.quantity * l.unitPrice }));
    const total = rows.reduce((sum, r) => sum + r.total, 0);
    await db.serviceItem.createMany({ data: rows.map((r) => ({ ...r, serviceJobId: job.id })) });
    await db.serviceJob.update({ where: { id: job.id }, data: { finalAmount: total } });
    invoiceSeq++;
    await db.invoice.create({
      data: {
        invoiceNumber: `INV-${YEAR}-${pad(invoiceSeq)}`,
        serviceJobId: job.id,
        labourTotal: rows.filter((r) => r.itemType === "LABOUR").reduce((s, r) => s + r.total, 0),
        partsTotal: rows.filter((r) => r.itemType === "PART").reduce((s, r) => s + r.total, 0),
        subtotal: total,
        tax: 0,
        discount: 0,
        total,
        invoiceDate: createdAt,
        items: { create: rows },
      },
    });
    // Sample rows only: "seed" provider links do not lead to a real payment page.
    await db.payment.create({
      data: {
        serviceJobId: job.id,
        customerId: vehicle.customerId,
        amount: total,
        paymentProvider: "seed",
        paymentOrderId: `seed_${job.id}`,
        status: status === "COMPLETED" ? "PAID" : "PENDING",
        paymentId: status === "COMPLETED" ? `seed_pay_${i}` : null,
        paidAt: status === "COMPLETED" ? new Date(createdAt.getTime() + 9 * 3_600_000) : null,
        createdAt,
      },
    });
  }

  const chats: [number, ["INBOUND" | "OUTBOUND", string, number][]][] = [
    [0, [["INBOUND", "Hi, I want to service my Hyundai Creta", 6], ["OUTBOUND", "Thanks! We've received your service request.", 5.9], ["INBOUND", "What's my car status?", 1]]],
    [1, [["INBOUND", "Is my car ready?", 3], ["OUTBOUND", "Your Honda City is currently under Inspection.", 2.9]]],
    [2, [["INBOUND", "Payment link please", 30], ["OUTBOUND", "Sure, we'll send it once the bill is ready.", 29.5]]],
    [3, [["INBOUND", "Thank you, great service!", 50]]],
  ];
  let wamid = 0;
  for (const [index, messages] of chats) {
    const customer = customers[index];
    for (const [direction, content, hours] of messages) {
      await db.whatsappMessage.create({
        data: {
          customerId: customer.id,
          direction,
          content,
          status: direction === "INBOUND" ? "RECEIVED" : "DELIVERED",
          sendieeMessageId: `seed.wamid.${++wamid}`,
          createdAt: hoursAgo(hours),
        },
      });
    }
    const last = messages[messages.length - 1];
    const lastInbound = [...messages].reverse().find((m) => m[0] === "INBOUND");
    await db.whatsappConversation.create({
      data: {
        customerId: customer.id,
        lastMessage: last[1],
        lastMessageAt: hoursAgo(last[2]),
        lastInboundAt: lastInbound ? hoursAgo(lastInbound[2]) : null,
        unreadCount: last[0] === "INBOUND" ? 1 : 0,
      },
    });
  }

  // Number generators must continue after the seeded rows.
  await db.sequence.createMany({
    data: [
      { key: "customer", value: CUSTOMERS.length },
      { key: "vehicle", value: CARS.length },
      { key: `service-${YEAR}`, value: JOB_STATUSES.length },
      { key: `invoice-${YEAR}`, value: invoiceSeq },
    ],
  });

  console.log(`Seeded. Log in as admin@serveai.local / ${DEV_PASSWORD}. Change these passwords before any real use.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
