import { redirect } from "next/navigation";
import { RoadScene } from "@/components/car-art";
import { LoginForm } from "@/components/login-form";
import { BRAND_TAGLINE, Logo } from "@/components/logo";
import { currentUser } from "@/lib/auth/page";
import { roleHome } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(roleHome[user.role]);
  const { center_name } = await getSettings();
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <RoadScene className="flex flex-col justify-center px-6 pt-8 pb-16 lg:px-14">
        <Logo name={center_name} className="text-xl lg:text-2xl" />
        <p className="mt-4 hidden max-w-sm text-3xl font-semibold text-balance lg:block">Every car, every job, every customer update in one place.</p>
        <p className="mt-2 text-sm text-slate-300">{BRAND_TAGLINE}</p>
      </RoadScene>
      <div className="flex items-center justify-center bg-muted/40 p-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-xl font-semibold">Log in</h1>
          <p className="mb-5 text-sm text-muted-foreground">Admin, reception and workers all start here.</p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
