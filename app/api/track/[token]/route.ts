import { open } from "@/lib/api/route";
import { publicTrackingView } from "@/lib/services/tracking";

export const GET = open(async ({ params }) => publicTrackingView(params.token), {
  limit: { name: "track", limit: 120, windowMs: 60_000 },
});
