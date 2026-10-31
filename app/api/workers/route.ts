import { authed } from "@/lib/api/route";
import { STAFF } from "@/lib/permissions";
import { workersWithLoad } from "@/lib/services/jobs";

export const GET = authed(STAFF, async () => workersWithLoad());
