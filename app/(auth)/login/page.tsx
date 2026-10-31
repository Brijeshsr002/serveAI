import { redirect } from "next/navigation";
import { LiveScene } from "@/components/live-scene";
import { CLIPS } from "@/lib/media-clips";
import { LoginForm } from "@/components/login-form";
import { BRAND_TAGLINE, CRM_NAME, Logo } from "@/components/logo";
import { currentUser } from "@/lib/auth/page";
import { roleHome } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(roleHome[user.role]);
  const { center_name } = await getSettings();
  return (
    <LiveScene clips={CLIPS.workshop} className="min-h-screen">
      <main className="mx-auto grid min-h-screen w-full max-w-6xl items-center gap-8 p-5 lg:grid-cols-[1fr_24rem] lg:p-10">
        <div>
          <Logo name={center_name} className="text-2xl lg:text-3xl" markClassName="size-14" />
          <h1 className="mt-6 hidden max-w-xl text-5xl font-bold tracking-tight text-balance lg:block">Every car, cared for like it&apos;s your own.</h1>
          <p className="mt-3 max-w-lg text-slate-200 lg:text-lg">{BRAND_TAGLINE}</p>
        </div>
        <div className="rounded-2xl bg-card p-6 text-card-foreground shadow-2xl">
          <h2 className="text-xl font-semibold">Welcome back</h2>
          <p className="mb-5 text-sm text-muted-foreground">Log in to {CRM_NAME}</p>
          <LoginForm />
        </div>
      </main>
    </LiveScene>
  );
}
