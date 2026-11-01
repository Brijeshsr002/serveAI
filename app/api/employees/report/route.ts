import { NextResponse } from "next/server";
import { authed } from "@/lib/api/route";
import { ADMIN_ONLY } from "@/lib/permissions";
import { employeeReportCsv, monthParam } from "@/lib/services/employees";

export const GET = authed(ADMIN_ONLY, async ({ req }) => {
  const month = monthParam(req.nextUrl.searchParams.get("month"));
  return new NextResponse(await employeeReportCsv(month), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="employees-${month}.csv"`,
      // Holds salaries.
      "Cache-Control": "no-store",
    },
  });
});
