import { beforeEach, describe, expect, it } from "vitest";
import { GET as listCustomers, POST as createCustomerRoute } from "@/app/api/customers/route";
import { DELETE as deleteCustomerRoute, PATCH as patchCustomer } from "@/app/api/customers/[id]/route";
import { POST as createVehicleRoute } from "@/app/api/vehicles/route";
import { POST as createJobRoute } from "@/app/api/service-jobs/route";
import { PATCH as patchJob } from "@/app/api/service-jobs/[id]/route";
import { GET as search } from "@/app/api/search/route";
import { db } from "@/lib/db";
import { call, loginCookie, makeCustomer, makeJob, makeUser, makeVehicle } from "./helpers";

let cookie: string;

beforeEach(async () => {
  const r = await makeUser("RECEPTIONIST", "Rita");
  cookie = await loginCookie(r.email);
});

describe("customers", () => {
  it("creates with a sequential code, a normalized phone and an audit entry", async () => {
    const { status, json } = await call(createCustomerRoute, "POST", {
      cookie,
      body: { name: "Asha", phone: "+91 98765-43210" },
    });
    expect(status).toBe(201);
    expect(json.data.phone).toBe("919876543210");
    expect(json.data.customerCode).toBe("CUS-000001");
    expect(await db.activityLog.count({ where: { action: "CUSTOMER_CREATED" } })).toBe(1);
  });

  it("treats the same number in different formats as a duplicate", async () => {
    await call(createCustomerRoute, "POST", { cookie, body: { name: "A", phone: "9876543210" } });
    for (const phone of ["+919876543210", "09876543210", "98765 43210"]) {
      const { status, json } = await call(createCustomerRoute, "POST", { cookie, body: { name: "B", phone } });
      expect(status).toBe(409);
      expect(json.error.code).toBe("DUPLICATE_PHONE");
    }
    expect(await db.customer.count()).toBe(1);
  });

  it("does not create two customers under a concurrent race", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => call(createCustomerRoute, "POST", { cookie, body: { name: "R", phone: "9811111111" } })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.customer.count()).toBe(1);
  });

  it("rejects an invalid phone with a structured error", async () => {
    const { status, json } = await call(createCustomerRoute, "POST", { cookie, body: { name: "A", phone: "12345" } });
    expect(status).toBe(400);
    expect(json).toMatchObject({ success: false, error: { code: "INVALID_PHONE" } });
  });

  it("PATCH leaves fields that were not sent untouched", async () => {
    const created = await call(createCustomerRoute, "POST", {
      cookie,
      body: { name: "Asha", phone: "9876543210", email: "a@x.io", city: "Coimbatore" },
    });
    await call(patchCustomer, "PATCH", { cookie, params: { id: created.json.data.id }, body: { name: "Asha K" } });
    const row = await db.customer.findUniqueOrThrow({ where: { id: created.json.data.id } });
    expect(row).toMatchObject({ name: "Asha K", email: "a@x.io", city: "Coimbatore" });
  });

  it("finds customers by vehicle number", async () => {
    const c = await makeCustomer();
    await makeVehicle(c.id, "TN38AB1234");
    const { json } = await call(listCustomers, "GET", { cookie, path: "/api/customers?q=tn 38 ab" });
    expect(json.data.map((x: any) => x.id)).toEqual([c.id]);
  });

  it("refuses to delete a customer with service history", async () => {
    const admin = await makeUser("ADMIN", "Admin");
    const adminCookie = await loginCookie(admin.email);
    const { customer } = await makeJob();
    const { status, json } = await call(deleteCustomerRoute, "DELETE", { cookie: adminCookie, params: { id: customer.id } });
    expect(status).toBe(409);
    expect(json.error.code).toBe("CUSTOMER_HAS_HISTORY");
  });
});

describe("vehicles", () => {
  it("creates a vehicle with a normalized registration", async () => {
    const c = await makeCustomer();
    const { status, json } = await call(createVehicleRoute, "POST", {
      cookie,
      body: { customerId: c.id, registrationNumber: "tn 38 ab-1234", brand: "Hyundai", model: "Creta", manufacturingYear: "2022" },
    });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ registrationNumber: "TN38AB1234", manufacturingYear: 2022, vehicleCode: "VEH-000001" });
  });

  it("lets a customer have several vehicles but rejects a duplicate registration", async () => {
    const c = await makeCustomer();
    const base = { customerId: c.id, brand: "Honda", model: "City" };
    expect((await call(createVehicleRoute, "POST", { cookie, body: { ...base, registrationNumber: "TN01AA1111" } })).status).toBe(201);
    expect((await call(createVehicleRoute, "POST", { cookie, body: { ...base, registrationNumber: "TN01AA2222" } })).status).toBe(201);
    const dup = await call(createVehicleRoute, "POST", { cookie, body: { ...base, registrationNumber: "TN 01 AA 1111" } });
    expect(dup.status).toBe(409);
  });
});

describe("service jobs", () => {
  it("creates with SRV number, random token and a first history row", async () => {
    const c = await makeCustomer();
    const v = await makeVehicle(c.id);
    const { status, json } = await call(createJobRoute, "POST", {
      cookie,
      body: { customerId: c.id, vehicleId: v.id, serviceType: "AC Service", estimatedAmount: "2500" },
    });
    expect(status).toBe(201);
    expect(json.data.serviceNumber).toMatch(new RegExp(`^SRV-${new Date().getFullYear()}-000001$`));
    expect(json.data.trackingToken).toMatch(/^[a-f0-9]{64}$/);
    expect(json.data.status).toBe("NEW");
    expect(await db.serviceStatusHistory.count({ where: { serviceJobId: json.data.id } })).toBe(1);
  });

  it("rejects a vehicle belonging to another customer", async () => {
    const a = await makeCustomer("919000000001", "A");
    const b = await makeCustomer("919000000002", "B");
    const v = await makeVehicle(b.id);
    const { status, json } = await call(createJobRoute, "POST", {
      cookie,
      body: { customerId: a.id, vehicleId: v.id, serviceType: "AC Service" },
    });
    expect(status).toBe(400);
    expect(json.error.code).toBe("VEHICLE_CUSTOMER_MISMATCH");
  });

  it("gives unique numbers under concurrent creation", async () => {
    const c = await makeCustomer();
    const v = await makeVehicle(c.id);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        call(createJobRoute, "POST", { cookie, body: { customerId: c.id, vehicleId: v.id, serviceType: "Wash" } }),
      ),
    );
    const numbers = results.map((r) => r.json.data.serviceNumber);
    expect(new Set(numbers).size).toBe(8);
  });

  it("PATCH does not wipe fields that were not sent", async () => {
    const { job } = await makeJob();
    await call(patchJob, "PATCH", { cookie, params: { id: job.id }, body: { priority: "HIGH" } });
    const row = await db.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.priority).toBe("HIGH");
    expect(row.internalNotes).toBe("SECRET-INTERNAL-NOTE");
    expect(row.estimatedAmount?.toString()).toBe("3000");
  });
});

describe("global search", () => {
  it("finds customer, vehicle and job from a registration number", async () => {
    const { customer, vehicle, job } = await makeJob();
    const { json } = await call(search, "GET", { cookie, path: "/api/search?q=TN38AB1234" });
    expect(json.data.customers[0].id).toBe(customer.id);
    expect(json.data.vehicles[0].id).toBe(vehicle.id);
    expect(json.data.jobs[0].id).toBe(job.id);
  });
});
