import { NextRequest, NextResponse } from "next/server";
import { Prisma, type Role } from "@prisma/client";
import { ZodError, type ZodType } from "zod";
import { SESSION_COOKIE, userFromToken, type SessionUser } from "@/lib/auth/session";
import { ApiError, forbidden } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export type Actor = { id: string | null; role: string; name: string; ip?: string | null };

type Ctx<User> = {
  req: NextRequest;
  params: Record<string, string>;
  user: User;
  actor: Actor;
  ip: string | null;
  body: <T>(schema: ZodType<T>) => Promise<T>;
};

type Limit = { limit: number; windowMs: number; name: string };

type Opts = { limit?: Limit };
type RouteArgs = { params: Promise<Record<string, string>> };

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

export const ok = (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status });

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { success: false, error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message } }, { status: 400 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Record not found" } },
      { status: 404 },
    );
  }
  console.error("Unhandled API error:", err);
  return NextResponse.json(
    { success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}

/** Rejects cookie-authenticated writes coming from another site. */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (new URL(origin).host !== host) throw forbidden("Cross-site request rejected");
}

function wrap<User>(
  resolve: (req: NextRequest) => Promise<{ user: User; actor: Actor }>,
  handler: (ctx: Ctx<User>) => Promise<unknown>,
  opts: Opts,
) {
  return async (req: NextRequest, args?: RouteArgs) => {
    try {
      const ip = clientIp(req);
      if (opts.limit && !rateLimit(`${opts.limit.name}:${ip ?? "unknown"}`, opts.limit.limit, opts.limit.windowMs)) {
        throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait and try again.");
      }
      const { user, actor } = await resolve(req);
      const result = await handler({
        req,
        params: (await args?.params) ?? {},
        user,
        actor: { ...actor, ip },
        ip,
        body: async (schema) => schema.parse(await req.json().catch(() => ({}))),
      });
      return result instanceof Response ? result : ok(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Authenticated route. Every staff endpoint goes through this; `roles` is enforced on the server. */
export function authed(roles: Role[], handler: (ctx: Ctx<SessionUser>) => Promise<unknown>, opts: Opts = {}) {
  return wrap<SessionUser>(
    async (req) => {
      const user = await userFromToken(req.cookies.get(SESSION_COOKIE)?.value);
      if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Please log in");
      if (!roles.includes(user.role)) throw forbidden();
      assertSameOrigin(req);
      return { user, actor: { id: user.id, role: user.role, name: user.name } };
    },
    handler,
    opts,
  );
}

/** Unauthenticated route: login, webhooks and token-authorised customer tracking. */
export function open(handler: (ctx: Ctx<null>) => Promise<unknown>, opts: Opts = {}) {
  return wrap<null>(async () => ({ user: null, actor: { id: null, role: "CUSTOMER", name: "Customer" } }), handler, opts);
}
