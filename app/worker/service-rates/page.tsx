import { RatesView } from "@/components/rates-view";
import { requireRole } from "@/lib/auth/page";

export default async function Page() {
  await requireRole(["WORKER"]);
  return <RatesView />;
}
