import { Shell } from "@/components/shell";
import { requireRole } from "@/lib/auth/page";
import { getSettings } from "@/lib/settings";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["WORKER"]);
  const { center_name } = await getSettings();
  return <Shell role={user.role} name={user.name} garage={center_name}>{children}</Shell>;
}
