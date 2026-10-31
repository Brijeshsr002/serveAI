import { NextResponse } from "next/server";
import { authed } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { ADMIN_ONLY } from "@/lib/permissions";
import { exportCsv } from "@/lib/services/reports";

export const GET = authed(ADMIN_ONLY, async ({ req }) => {
  const type = req.nextUrl.searchParams.get("type") ?? "";
  const csv = await exportCsv(type);
  if (csv === null) throw badRequest("UNKNOWN_REPORT", "Report type must be services, payments or workers");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${type}.csv"` },
  });
});
