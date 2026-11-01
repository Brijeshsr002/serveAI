import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/page";

/** Moved to Billing. Kept so old links and bookmarks still land in the right place. */
export default async function ReceptionPaymentsPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  await requireRole(["RECEPTIONIST"]);
  const { view } = await searchParams;
  redirect(`/reception/billing${view === "list" ? "?view=list" : ""}`);
}
