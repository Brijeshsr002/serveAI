import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { Logo } from "@/components/logo";
import { currentUser } from "@/lib/auth/page";
import { roleHome } from "@/lib/permissions";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(roleHome[user.role]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <Logo tagline className="mx-auto mb-6 h-20" />
        <LoginForm showDevAccounts={process.env.NODE_ENV !== "production"} />
      </div>
    </main>
  );
}
