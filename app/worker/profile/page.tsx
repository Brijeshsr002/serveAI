import { OwnProfile } from "@/components/own-profile";
import { requireRole } from "@/lib/auth/page";

export default async function ProfilePage() {
  const user = await requireRole(["WORKER"]);
  return <OwnProfile userId={user.id} jobsBase="/worker" />;
}
