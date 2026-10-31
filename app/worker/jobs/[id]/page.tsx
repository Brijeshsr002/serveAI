import { notFound } from "next/navigation";
import { ActionButton, FormDialog } from "@/components/actions";
import { workerItemFields } from "@/components/forms-config";
import { Field, PageHeader, Section, SimpleTable, StatusBadge } from "@/components/ui-kit";
import { WorkerActions } from "@/components/worker-job-card";
import { requireRole } from "@/lib/auth/page";
import { dateTime, money } from "@/lib/format";
import { getJobForUser } from "@/lib/services/jobs";
import { isTerminal, STATUS_LABEL, workerNextStatuses } from "@/lib/status";
import { VoiceStatus } from "@/components/voice-status";

export default async function WorkerJobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["WORKER"]);
  const { id } = await params;
  const job = await getJobForUser(user, id).catch(() => null);
  if (!job) notFound();
  const canEditBill = !isTerminal(job.status) && !job.payments.some((p) => ["PAID", "PENDING", "PROCESSING"].includes(p.status));
  return (
    <>
      <PageHeader title={job.serviceNumber} subtitle={job.serviceType}><StatusBadge status={job.status} /></PageHeader>
      <div className="max-w-2xl space-y-4">
        <WorkerActions jobId={job.id} status={job.status} />
        <VoiceStatus jobId={job.id} options={workerNextStatuses(job.status)} />
        <Section
          title="Parts and extra work"
          action={canEditBill && <FormDialog trigger="Add part or work" title="Add part or extra work" endpoint={`/api/service-jobs/${job.id}/items`} fields={workerItemFields} initial={{ itemType: "PART", quantity: 1 }} submitLabel="Add and tell customer" success="Added. Customer is being told on WhatsApp." />}
        >
          {canEditBill && <p className="mb-3 text-sm text-muted-foreground">The customer gets a WhatsApp message for every change.</p>}
          {!canEditBill && !isTerminal(job.status) && <p className="mb-3 text-sm text-muted-foreground">The bill is with the customer. Ask reception to change it.</p>}
          <SimpleTable
            headers={["Item", "Qty", "Cost", ""]}
            empty="Nothing added yet"
            rows={job.items.map((i) => [
              i.name,
              Number(i.quantity),
              money(i.total),
              canEditBill && (
                <div key="x" className="flex gap-1">
                  <FormDialog trigger="Edit" title={`Edit ${i.name}`} variant="ghost" method="PATCH" endpoint={`/api/service-jobs/${job.id}/items/${i.id}`} fields={workerItemFields} initial={{ itemType: i.itemType, name: i.name, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) }} submitLabel="Save and tell customer" success="Updated. Customer is being told on WhatsApp." />
                  <ActionButton label="Remove" variant="ghost" method="DELETE" endpoint={`/api/service-jobs/${job.id}/items/${i.id}`} confirm={`Remove ${i.name}? The customer will be told on WhatsApp.`} success="Removed" />
                </div>
              ),
            ])}
          />
          {job.items.length > 0 && <p className="mt-3 text-right text-sm font-semibold">Total: {money(job.items.reduce((sum, i) => sum + Number(i.total), 0))}</p>}
        </Section>
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
