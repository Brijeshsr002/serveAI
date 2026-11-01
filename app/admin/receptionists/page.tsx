import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/page";

/** The old page's address, kept for bookmarks. */
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireRole(["ADMIN"]);
  redirect((await searchParams).view === "list" ? "/admin/employees?view=list" : "/admin/employees");
}
