import { BillingView } from "@/components/billing-view";
import { requireRole } from "@/lib/auth/page";

export default async function ReceptionBillingPage() {
  await requireRole(["RECEPTIONIST"]);
  return BillingView({ base: "/reception", withInvoices: false });
}
