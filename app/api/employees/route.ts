import { authed, ok } from "@/lib/api/route";
import { ADMIN_ONLY } from "@/lib/permissions";
import { createEmployee, employeeCreateSchema, listEmployees, monthParam } from "@/lib/services/employees";

export const GET = authed(ADMIN_ONLY, async ({ req }) => {
  const { searchParams } = req.nextUrl;
  return listEmployees({ q: searchParams.get("q") ?? undefined, month: monthParam(searchParams.get("month")) });
});

export const POST = authed(ADMIN_ONLY, async ({ actor, body }) => ok(await createEmployee(actor, await body(employeeCreateSchema)), 201));
