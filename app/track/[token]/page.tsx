import type { Metadata } from "next";
import type { ServiceStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import { Check, Phone } from "lucide-react";
import { ActionButton } from "@/components/actions";
import { Logo } from "@/components/logo";
import { PaymentBadge, StatusBadge } from "@/components/ui-kit";
import { buttonVariants } from "@/components/ui/button";
import { dateTime, money } from "@/lib/format";
import { publicTrackingView } from "@/lib/services/tracking";
import { STATUS_LABEL, STATUSES } from "@/lib/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Track your service",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const STEPS: ServiceStatus[] = STATUSES.filter((s) => s !== "CANCELLED" && s !== "WAITING_FOR_PARTS");

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await publicTrackingView(token).catch(() => null);
  if (!view) notFound();

  const paid = view.paymentStatus === "PAID";
  const reachedAt = new Map(view.timeline.map((t) => [t.status, t.at]));
  const currentIndex = STEPS.indexOf(view.status === "WAITING_FOR_PARTS" ? "SERVICE_IN_PROGRESS" : view.status);

  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-4 bg-background p-4">
      <header className="flex items-center justify-between pt-2">
        <Logo className="h-8" />
        <span className="text-xs text-muted-foreground">{view.serviceNumber}</span>
      </header>

      <section className="rounded-xl border p-4">
        <p className="text-sm text-muted-foreground">Hi {view.customerName}</p>
        <h1 className="mt-1 text-lg font-semibold">{view.vehicle.brand} {view.vehicle.model}</h1>
        <p className="text-sm font-medium tracking-wide">{view.vehicle.registrationNumber}</p>
        <p className="mt-1 text-sm text-muted-foreground">{view.serviceType}</p>
        <div className="mt-3"><StatusBadge status={view.status} /></div>
        {view.completedAt && <p className="mt-2 text-sm text-muted-foreground">Completed {dateTime(view.completedAt)}</p>}
      </section>

      <section className="rounded-xl border p-4">
        <h2 className="mb-3 font-medium">Progress</h2>
        {view.status === "CANCELLED" ? (
          <p className="text-sm">This service request was cancelled.</p>
        ) : (
          <ol className="space-y-3">
            {STEPS.map((step, i) => {
              const done = i <= currentIndex;
              return (
                <li key={step} className="flex items-start gap-3">
                  <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border", done && "border-primary bg-primary text-primary-foreground")}>
                    {done && <Check className="size-3" />}
                  </span>
                  <div className={cn("text-sm", !done && "text-muted-foreground", i === currentIndex && "font-medium")}>
                    {STATUS_LABEL[step]}
                    {i === currentIndex && view.status === "WAITING_FOR_PARTS" && " (waiting for parts)"}
                    {reachedAt.get(step) && <div className="text-xs font-normal text-muted-foreground">{dateTime(reachedAt.get(step))}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Cost</h2>
          <PaymentBadge status={view.paymentStatus as "PAID"} />
        </div>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Estimated</dt><dd>{money(view.estimatedAmount)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Final amount</dt><dd>{money(view.finalAmount)}</dd></div>
        </dl>
        {view.hasInvoice && !paid && view.status !== "CANCELLED" && (
          <ActionButton label="Pay now" size="lg" className="w-full" endpoint={`/api/track/${token}/pay`} openKey="paymentLink" />
        )}
        {view.hasInvoice && (
          <a className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")} href={`/api/track/${token}/invoice`}>View invoice</a>
        )}
      </section>

      <section className="rounded-xl border p-4 text-sm">
        <p className="font-medium">{view.serviceCenter.name}</p>
        {view.serviceCenter.address && <p className="text-muted-foreground">{view.serviceCenter.address}</p>}
        {view.serviceCenter.phone && (
          <a className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-3 w-full")} href={`tel:${view.serviceCenter.phone}`}>
            <Phone className="mr-2 size-4" /> Contact service center
          </a>
        )}
      </section>
    </main>
  );
}
