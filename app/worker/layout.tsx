import { Shell } from "@/components/shell";
import { requireRole } from "@/lib/auth/page";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["WORKER"]);
  return <Shell role={user.role} name={user.name}>{children}</Shell>;
}
