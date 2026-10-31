import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/page";
import { roleHome } from "@/lib/permissions";

export default async function Home() {
  const user = await currentUser();
  redirect(user ? roleHome[user.role] : "/login");
}
