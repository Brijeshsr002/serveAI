import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/page";
import { roleBase, STAFF } from "@/lib/permissions";
import { movedTo } from "@/lib/redirects";

/** Moved to the Customers tab of Customers & Jobs. Old links and bookmarks land there, with their query. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(STAFF);
  redirect(movedTo(`${roleBase[user.role]}/customers-jobs`, await searchParams, { tab: "customers" }));
}
