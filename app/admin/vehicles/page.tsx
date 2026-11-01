import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/page";
import { roleBase, STAFF } from "@/lib/permissions";

/** Vehicles live on the Customers page now. Old links and bookmarks land there, with their search and view. */
export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const user = await requireRole(STAFF);
  const { q, view } = await searchParams;
  const query = [...(view === "list" ? ["view=list"] : []), ...(q ? [`q=${encodeURIComponent(q)}`] : [])].join("&");
  redirect(`${roleBase[user.role]}/customers${query ? `?${query}` : ""}`);
}
