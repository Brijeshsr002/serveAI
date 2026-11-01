import { BillingView } from "@/components/billing-view";
import { requireRole } from "@/lib/auth/page";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; view?: string | string[] }> }) {
  await requireRole(["ADMIN"]);
  const { tab, view } = await searchParams;
  return BillingView({ base: "/admin", withInvoices: true, tab, view });
}
