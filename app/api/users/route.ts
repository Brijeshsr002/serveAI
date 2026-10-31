import { Role } from "@prisma/client";
import { authed, ok } from "@/lib/api/route";
import { db } from "@/lib/db";
import { ADMIN_ONLY } from "@/lib/permissions";
import { createUser, userSchema, userSelect } from "@/lib/services/users";

export const GET = authed(ADMIN_ONLY, async ({ req }) => {
  const role = req.nextUrl.searchParams.get("role");
  return db.user.findMany({
    where: role && role in Role ? { role: role as Role } : {},
    orderBy: { name: "asc" },
    select: userSelect,
  });
});

export const POST = authed(ADMIN_ONLY, async ({ actor, body }) => ok(await createUser(actor, await body(userSchema)), 201));
