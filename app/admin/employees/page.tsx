import { EmployeesView } from "@/components/employees-view";
import { requireRole } from "@/lib/auth/page";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  await requireRole(["ADMIN"]);
  const { view, q } = await searchParams;
  return <EmployeesView view={view} q={q} />;
}
