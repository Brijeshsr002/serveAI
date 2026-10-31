import { jwtVerify, SignJWT } from "jose";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "serveai_session";
const SESSION_SECONDS = 60 * 60 * 12;

export type SessionUser = Pick<User, "id" | "name" | "email" | "phone" | "role">;

function secret() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value || value.length < 16) throw new Error("NEXTAUTH_SECRET must be set (16+ characters)");
  return new TextEncoder().encode(value);
}

export function createSessionToken(userId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secret());
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Plain-http deployments (local Docker) could not log in with Secure set.
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_SECONDS,
  };
}

/** Reads the user from the database each time, so deactivating someone takes effect at once. */
export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, phone: true, role: true, active: true },
    });
    if (!user?.active) return null;
    const { active: _active, ...sessionUser } = user;
    return sessionUser;
  } catch {
    return null;
  }
}
