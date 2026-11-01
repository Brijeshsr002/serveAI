import { RatesView } from "@/components/rates-view";
import { requireRole } from "@/lib/auth/page";

export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string | string[] }> }) {
  await requireRole(["WORKER"]);
  return RatesView({ kind: (await searchParams).kind });
}
