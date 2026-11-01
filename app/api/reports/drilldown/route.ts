import { authed } from "@/lib/api/route";
import { ADMIN_ONLY } from "@/lib/permissions";
import { drilldown, drilldownSchema } from "@/lib/services/reports";

export const GET = authed(ADMIN_ONLY, async ({ req }) => drilldown(drilldownSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
