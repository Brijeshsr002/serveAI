import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/page";

/** Moved to Billing. Kept so old links and bookmarks still land in the right place. */
export default async function InvoicesPage() {
  await requireRole(["ADMIN"]);
  redirect("/admin/billing?tab=invoices");
}
