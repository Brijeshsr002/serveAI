import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/page";
import { roleBase, STAFF } from "@/lib/permissions";

/** Vehicles live on the Customers page now. Old links and bookmarks land there, search included. */
export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireRole(STAFF);
  const { q } = await searchParams;
  redirect(`${roleBase[user.role]}/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}
