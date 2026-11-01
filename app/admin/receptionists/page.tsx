import { UsersView } from "@/components/users-view";
import { requireRole } from "@/lib/auth/page";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireRole(["ADMIN"]);
  return <UsersView role="RECEPTIONIST" title="Receptionists" view={(await searchParams).view} />;
}
