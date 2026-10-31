import Link from "next/link";
import type { ServiceStatus } from "@prisma/client";
import { ActionButton } from "@/components/actions";
import { StatusBadge } from "@/components/ui-kit";
import { money } from "@/lib/format";
import { WORKER_ACTION, workerNextStatuses } from "@/lib/status";

type Job = {
  id: string;
  serviceNumber: string;
  serviceType: string;
  customerComplaint: string | null;
  estimatedAmount: unknown;
  status: ServiceStatus;
  customer: { name: string };
  vehicle: { brand: string; model: string; registrationNumber: string };
};

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

export function WorkerJobCard({ job }: { job: Job }) {
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
      <WorkerActions jobId={job.id} status={job.status} />
    </article>
  );
}
