import { authed } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { isDayKey } from "@/lib/format";
import { ADMIN_ONLY } from "@/lib/permissions";
import { teamDay } from "@/lib/services/attendance";

export const GET = authed(ADMIN_ONLY, async ({ req }) => {
  const date = req.nextUrl.searchParams.get("date");
  if (date !== null && !isDayKey(date)) throw badRequest("INVALID_DATE", "Enter a valid date as yyyy-mm-dd");
  return teamDay(date ?? undefined);
});
