import type { Metadata } from "next";
import type { ServiceStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import { Check, Phone } from "lucide-react";
import { ActionButton } from "@/components/actions";
import { LiveScene } from "@/components/live-scene";
import { CLIPS } from "@/lib/media-clips";
import { LiveRefresh } from "@/components/live-refresh";
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

/** Plain words for customers, so nobody has to decode a status name. */
const STATUS_HINT: Record<ServiceStatus, string> = {
  NEW: "We have your request.",
  ASSIGNED: "Our team will start on your car soon.",
  VEHICLE_RECEIVED: "Your car is with us.",
  INSPECTION: "We are checking your car.",
  SERVICE_IN_PROGRESS: "We are working on your car.",
  WAITING_FOR_PARTS: "We are waiting for a part.",
  READY_FOR_DELIVERY: "Your car is ready to collect.",
  COMPLETED: "All done. Thank you!",
  CANCELLED: "This service was cancelled.",
};

const STEPS: ServiceStatus[] =STATUSES.filter((s) => s !== "CANCELLED" && s !== "WAITING_FOR_PARTS");

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
        <Logo name={view.serviceCenter.name} />
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><LiveRefresh /> {view.serviceNumber}</span>
      </header>

      <LiveScene clips={CLIPS.service} className="rounded-2xl" overlay="bg-slate-950/70">
        <div className="p-4">
        <p className="text-sm text-slate-300">Hi {view.customerName}</p>
        <p className="mt-1 text-xl font-semibold text-balance">{STATUS_HINT[view.status]}</p>
        <h1 className="mt-3 font-medium">{view.vehicle.brand} {view.vehicle.model} · {view.vehicle.registrationNumber}</h1>
        <p className="text-sm text-slate-300">{view.serviceType}</p>
        <div className="mt-3"><StatusBadge status={view.status} /></div>
        {view.completedAt && <p className="mt-2 text-sm text-slate-300">Completed {dateTime(view.completedAt)}</p>}
        </div>
      </LiveScene>

      {view.awaitingApproval.length > 0 && (
        <section className="space-y-3 rounded-xl border-2 border-primary bg-accent/40 p-4">
          <h2 className="font-semibold">We need your OK</h2>
          <p className="text-sm text-muted-foreground">We found extra work on your car. It's only added to your bill if you approve it.</p>
          {view.awaitingApproval.map((item) => (
            <div key={item.ref} className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex justify-between gap-3 text-sm font-medium">
                <span className="min-w-0 break-words">{item.name}{item.quantity !== "1" && ` × ${item.quantity}`}</span>
                <span className="shrink-0">{money(item.total)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ActionButton label="Yes, add it" size="lg" endpoint={`/api/track/${token}/approval`} body={{ ref: item.ref, approve: true }} success="Added to your bill" />
                <ActionButton label="No, skip it" size="lg" variant="outline" endpoint={`/api/track/${token}/approval`} body={{ ref: item.ref, approve: false }} success="Skipped" />
              </div>
            </div>
          ))}
        </section>
      )}

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
        {view.items.length > 0 && (
          <ul className="space-y-1 border-b pb-3 text-sm">
            {view.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-3"><span className="min-w-0 break-words">{item.name}{item.quantity !== "1" && ` × ${item.quantity}`}</span><span className="shrink-0">{money(item.total)}</span></li>
            ))}
          </ul>
        )}
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Estimated</dt><dd>{money(view.estimatedAmount)}</dd></div>
          {view.finalAmount
            ? <div className="flex justify-between text-base font-semibold"><dt>Final amount</dt><dd>{money(view.finalAmount)}</dd></div>
            : view.items.length > 0 && <div className="flex justify-between text-base font-semibold"><dt>Bill so far</dt><dd>{money(view.billSoFar)}</dd></div>}
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
            <Phone className="mr-2 size-4" /> Call the garage
          </a>
        )}
      </section>
    </main>
  );
}
