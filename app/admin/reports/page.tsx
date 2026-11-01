import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/page";

/** Reports are part of the admin dashboard now. Kept so old links and bookmarks still land in the right place. */
export default async function ReportsPage() {
  await requireRole(["ADMIN"]);
  redirect("/admin/dashboard");
}
