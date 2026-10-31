import { notFound } from "next/navigation";
import { Field, PageHeader, Section, StatusBadge } from "@/components/ui-kit";
import { WorkerActions } from "@/components/worker-job-card";
import { requireRole } from "@/lib/auth/page";
import { dateTime, money } from "@/lib/format";
import { getJobForUser } from "@/lib/services/jobs";
import { STATUS_LABEL } from "@/lib/status";

export default async function WorkerJobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["WORKER"]);
  const { id } = await params;
  const job = await getJobForUser(user, id).catch(() => null);
  if (!job) notFound();
  return (
    <>
      <PageHeader title={job.serviceNumber} subtitle={job.serviceType}><StatusBadge status={job.status} /></PageHeader>
      <div className="max-w-2xl space-y-4">
        <WorkerActions jobId={job.id} status={job.status} />
        <Section title="Job details">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Customer">{job.customer.name}</Field>
            <Field label="Phone"><a className="text-primary" href={`tel:+${job.customer.phone}`}>+{job.customer.phone}</a></Field>
            <Field label="Vehicle">{job.vehicle.brand} {job.vehicle.model}</Field>
            <Field label="Registration">{job.vehicle.registrationNumber}</Field>
            <Field label="Assigned">{dateTime(job.statusHistory.find((h) => h.newStatus === "ASSIGNED")?.createdAt)}</Field>
            <Field label="Expected completion">{dateTime(job.expectedCompletion)}</Field>
            <Field label="Estimated amount">{money(job.estimatedAmount)}</Field>
            <div className="col-span-2"><Field label="Complaint">{job.customerComplaint}</Field></div>
            <div className="col-span-2"><Field label="Notes">{job.internalNotes}</Field></div>
          </dl>
        </Section>
        <Section title="Timeline">
          <ol className="space-y-2 border-l pl-3 text-sm">
            {job.statusHistory.map((h) => (
              <li key={h.id}><span className="text-xs text-muted-foreground">{dateTime(h.createdAt)}</span><p>{STATUS_LABEL[h.newStatus]}</p></li>
            ))}
          </ol>
        </Section>
      </div>
    </>
  );
}
