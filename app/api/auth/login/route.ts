import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { open } from "@/lib/api/route";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { roleHome } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("serveai-dummy-password", 10);

export const POST = open(
  async ({ body, ip }) => {
    const { email, password } = await body(schema);
    if (!rateLimit(`login-email:${email}`, 10, 15 * 60_000)) {
      throw new ApiError(429, "RATE_LIMITED", "Too many login attempts. Please wait and try again.");
    }
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, name: true, role: true, active: true, passwordHash: true },
    });
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid || !user.active) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
    }
    await logActivity(
      { id: user.id, role: user.role, name: user.name, ip },
      { action: "LOGIN", entityType: "User", entityId: user.id, summary: `${user.name} logged in` },
    );
    const res = NextResponse.json({
      success: true,
      data: { id: user.id, name: user.name, role: user.role, redirectTo: roleHome[user.role] },
    });
    res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions());
    return res;
  },
  { limit: { name: "login", limit: 30, windowMs: 15 * 60_000 } },
);
