import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/page";
import { movedTo } from "@/lib/redirects";

/** Moved to the Attendance tab of Employees. Old links and bookmarks land there on the same date. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(["ADMIN"]);
  redirect(movedTo("/admin/employees", await searchParams, { tab: "attendance" }));
}
