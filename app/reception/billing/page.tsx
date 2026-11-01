import { BillingView } from "@/components/billing-view";
import { requireRole } from "@/lib/auth/page";

export default async function ReceptionBillingPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  await requireRole(["RECEPTIONIST"]);
  const { view } = await searchParams;
  return BillingView({ base: "/reception", withInvoices: false, view });
}
