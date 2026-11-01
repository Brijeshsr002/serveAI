import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/page";

/** Moved to Billing. Kept so old links and bookmarks still land in the right place. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  await requireRole(["ADMIN"]);
  const { view } = await searchParams;
  redirect(`/admin/billing?tab=invoices${view === "list" ? "&view=list" : ""}`);
}
