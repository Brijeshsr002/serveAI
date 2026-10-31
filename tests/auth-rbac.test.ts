import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as customers, POST as createCustomerRoute } from "@/app/api/customers/route";
import { DELETE as deleteCustomerRoute } from "@/app/api/customers/[id]/route";
import { GET as logs } from "@/app/api/activity-logs/route";
import { GET as settings } from "@/app/api/settings/route";
import { GET as users, POST as createUserRoute } from "@/app/api/users/route";
import { PATCH as patchUser } from "@/app/api/users/[id]/route";
import { db } from "@/lib/db";
import { call, loginCookie, makeCustomer, makeUser, PASSWORD, request } from "./helpers";

describe("authentication", () => {
  it("logs in and sets an httpOnly session, redirecting by role", async () => {
    await makeUser("WORKER", "Raj");
    const res = await login(request("POST", "/x", { body: { email: "raj@test.local", password: PASSWORD } }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect((await res.json()).data.redirectTo).toBe("/worker/dashboard");
  });

  it("rejects a wrong password and an unknown email identically", async () => {
    await makeUser("ADMIN", "Admin");
    const wrong = await call(login, "POST", { body: { email: "admin@test.local", password: "nope" } });
    const unknown = await call(login, "POST", { body: { email: "ghost@test.local", password: "nope" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json).toEqual(unknown.json);
  });

  it("stores passwords hashed", async () => {
    const user = await makeUser("ADMIN", "Admin");
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(user.passwordHash.startsWith("$2")).toBe(true);
  });

  it("rate limits repeated attempts on one account", async () => {
    await makeUser("ADMIN", "Admin");
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await call(login, "POST", { body: { email: "admin@test.local", password: "bad" } })).status;
    }
    expect(last).toBe(429);
  });

  it("rejects missing and tampered sessions", async () => {
    expect((await call(me, "GET")).status).toBe(401);
    expect((await call(me, "GET", { cookie: "serveai_session=garbage" })).status).toBe(401);
  });

  it("ends the session immediately when a user is deactivated", async () => {
    const worker = await makeUser("WORKER", "Raj");
    const cookie = await loginCookie(worker.email);
    expect((await call(me, "GET", { cookie })).status).toBe(200);
    await db.user.update({ where: { id: worker.id }, data: { active: false } });
    expect((await call(me, "GET", { cookie })).status).toBe(401);
  });
});

describe("RBAC on the server", () => {
  it("blocks workers from staff data", async () => {
    const worker = await makeUser("WORKER", "Raj");
    const cookie = await loginCookie(worker.email);
    expect((await call(customers, "GET", { cookie })).status).toBe(403);
    expect((await call(createCustomerRoute, "POST", { cookie, body: { name: "X", phone: "9000000000" } })).status).toBe(403);
    expect((await call(users, "GET", { cookie })).status).toBe(403);
  });

  it("blocks receptionists from admin endpoints", async () => {
    const r = await makeUser("RECEPTIONIST", "Rita");
    const cookie = await loginCookie(r.email);
    const customer = await makeCustomer();
    expect((await call(customers, "GET", { cookie })).status).toBe(200);
    expect((await call(users, "GET", { cookie })).status).toBe(403);
    expect((await call(settings, "GET", { cookie })).status).toBe(403);
    expect((await call(logs, "GET", { cookie })).status).toBe(403);
    expect((await call(createUserRoute, "POST", { cookie, body: { name: "H", email: "h@x.io", role: "ADMIN", password: "longenough" } })).status).toBe(403);
    expect((await call(deleteCustomerRoute, "DELETE", { cookie, params: { id: customer.id } })).status).toBe(403);
  });

  it("rejects cross-site writes that carry a valid cookie", async () => {
    const admin = await makeUser("ADMIN", "Admin");
    const cookie = await loginCookie(admin.email);
    const { status } = await call(createCustomerRoute, "POST", {
      cookie,
      body: { name: "X", phone: "9000000000" },
      headers: { origin: "https://evil.example" },
    });
    expect(status).toBe(403);
    expect(await db.customer.count()).toBe(0);
  });

  it("stops an admin from demoting themselves", async () => {
    const admin = await makeUser("ADMIN", "Admin");
    const cookie = await loginCookie(admin.email);
    const { status } = await call(patchUser, "PATCH", { cookie, params: { id: admin.id }, body: { role: "WORKER" } });
    expect(status).toBe(400);
  });

  it("never returns password hashes", async () => {
    const admin = await makeUser("ADMIN", "Admin");
    const cookie = await loginCookie(admin.email);
    const { json } = await call(users, "GET", { cookie });
    expect(JSON.stringify(json)).not.toContain("passwordHash");
  });
});
