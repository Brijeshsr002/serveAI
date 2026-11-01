import { authed } from "@/lib/api/route";
import { STAFF } from "@/lib/permissions";
import { customerOverview } from "@/lib/services/customers";

export const GET = authed(STAFF, async ({ params }) => customerOverview(params.id));
