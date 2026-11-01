import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import type { ServiceStatus } from "@prisma/client";
import { ActionButton } from "@/components/actions";
import { ApprovalBadge, StatusBadge } from "@/components/ui-kit";
import { VoiceStatus } from "@/components/voice-status";
import { WorkItemDialog, type WorkItem } from "@/components/work-item-dialog";
import { money } from "@/lib/format";
import { isTerminal, WORKER_ACTION, workerNextStatuses } from "@/lib/status";

type Job = {
  id: string;
  serviceNumber: string;
  serviceType: string;
  customerComplaint: string | null;
  estimatedAmount: unknown;
  status: ServiceStatus;
  customer: { name: string };
  vehicle: { brand: string; model: string; registrationNumber: string };
  items: { id: string; itemType: WorkItem["itemType"]; name: string; quantity: unknown; unitPrice: unknown; total: unknown; approval: "APPROVED" | "PENDING" | "DECLINED" }[];
  payments: { status: string }[];
};

/** The bill stays editable until the job closes or a payment link has gone out. */
export const canEditBill = (job: { status: ServiceStatus; payments: { status: string }[] }) =>
  !isTerminal(job.status) && !job.payments.some((p) => ["PAID", "PENDING", "PROCESSING"].includes(p.status));

export const toWorkItem = (i: Job["items"][number]): WorkItem => ({ id: i.id, itemType: i.itemType, name: i.name, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) });

export function WorkerActions({ jobId, status }: { jobId: string; status: ServiceStatus }) {
  return (
    <div className="flex flex-wrap gap-2">
      {workerNextStatuses(status).map((next) => (
        <ActionButton
          key={next}
          label={WORKER_ACTION[next] ?? next}
          size="lg"
          variant={next === "WAITING_FOR_PARTS" ? "outline" : "default"}
          className="flex-1 whitespace-nowrap"
          endpoint={`/api/service-jobs/${jobId}/status`}
          body={{ status: next }}
          success="Status updated"
        />
      ))}
    </div>
  );
}

export function WorkerJobCard({ job, prices }: { job: Job; prices?: Record<string, number> }) {
  const editable = canEditBill(job);
  return (
    <article className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/worker/jobs/${job.id}`} className="font-semibold text-primary hover:underline">{job.serviceNumber}</Link>
        <StatusBadge status={job.status} />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-xs text-muted-foreground">Customer</dt><dd>{job.customer.name}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Vehicle</dt><dd>{job.vehicle.brand} {job.vehicle.model}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Registration</dt><dd className="font-medium">{job.vehicle.registrationNumber}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Service</dt><dd>{job.serviceType}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-muted-foreground">Complaint</dt><dd>{job.customerComplaint || "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Estimated cost</dt><dd>{money(job.estimatedAmount as number)}</dd></div>
      </dl>
      <div className="rounded-lg bg-muted/50 p-2.5 text-sm">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Work and parts</p>
        {job.items.length === 0 && <p className="text-xs text-muted-foreground">Nothing added yet</p>}
        <ul className="space-y-1">
          {job.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 break-words">{i.name}{Number(i.quantity) !== 1 && ` × ${Number(i.quantity)}`}<ApprovalBadge approval={i.approval} /></span>
              <span className="flex shrink-0 items-center gap-1 tabular-nums">
                {money(i.total as number)}
                {editable && <WorkItemDialog jobId={job.id} item={toWorkItem(i)} prices={prices} variant="ghost" triggerSize="icon-sm" triggerLabel={`Edit ${i.name}`} trigger={<Pencil className="size-3.5" />} />}
              </span>
            </li>
          ))}
        </ul>
        {job.items.length > 0 && <p className="mt-1 border-t pt-1 text-right font-semibold">Approved total: {money(job.items.filter((i) => i.approval === "APPROVED").reduce((sum, i) => sum + Number(i.total), 0))}</p>}
        {job.items.some((i) => i.approval === "PENDING") && <p className="text-right text-xs text-amber-800">Waiting for customer: {money(job.items.filter((i) => i.approval === "PENDING").reduce((sum, i) => sum + Number(i.total), 0))}</p>}
        {editable
          ? <WorkItemDialog jobId={job.id} prices={prices} variant="outline" className="mt-2 w-full" trigger={<><Plus className="size-3.5" /> Edit work: add issue, service or part</>} />
          : <p className="mt-1 text-xs text-muted-foreground">Bill locked. Ask reception to change it.</p>}
      </div>
      <WorkerActions jobId={job.id} status={job.status} />
      <VoiceStatus jobId={job.id} options={workerNextStatuses(job.status)} />
    </article>
  );
}
