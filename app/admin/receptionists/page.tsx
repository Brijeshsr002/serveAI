import { UsersView } from "@/components/users-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  return <UsersView role="RECEPTIONIST" title="Receptionists" view={(await searchParams).view} />;
}
