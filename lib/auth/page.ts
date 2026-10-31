import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { roleHome } from "@/lib/permissions";
import { SESSION_COOKIE, userFromToken } from "./session";

export async function currentUser() {
  const store = await cookies();
  return userFromToken(store.get(SESSION_COOKIE)?.value);
}

/** Server-component guard: anonymous users go to login, wrong roles go to their own home. */
export async function requireRole(roles: Role[]) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect(roleHome[user.role]);
  return user;
}
