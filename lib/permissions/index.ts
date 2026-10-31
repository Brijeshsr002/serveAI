import type { Role } from "@prisma/client";

export const STAFF: Role[] = ["ADMIN", "RECEPTIONIST"];
export const ADMIN_ONLY: Role[] = ["ADMIN"];
export const ALL_ROLES: Role[] = ["ADMIN", "RECEPTIONIST", "WORKER"];

export const roleHome: Record<Role, string> = {
  ADMIN: "/admin/dashboard",
  RECEPTIONIST: "/reception/dashboard",
  WORKER: "/worker/dashboard",
};

export const roleBase: Record<Role, string> = {
  ADMIN: "/admin",
  RECEPTIONIST: "/reception",
  WORKER: "/worker",
};
