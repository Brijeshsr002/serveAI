import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { WorkItemDialog } from "@/components/work-item-dialog";
import { ApprovalBadge, Field, PageHeader, Section, SimpleTable, StatusBadge } from "@/components/ui-kit";
import { canEditBill, toWorkItem, WorkerActions } from "@/components/worker-job-card";
import { requireRole } from "@/lib/auth/page";
import { dateTime, money } from "@/lib/format";
import { getJobForUser } from "@/lib/services/jobs";
import { billCatalog } from "@/lib/services/service-rates";
import { isTerminal, STATUS_LABEL, workerNextStatuses } from "@/lib/status";
import { VoiceStatus } from "@/components/voice-status";

export default async function WorkerJobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["WORKER"]);
  const { id } = await params;
  const job = await getJobForUser(user, id).catch(() => null);
  if (!job) notFound();
  const canEdit = canEditBill(job);
  const catalog = await billCatalog();
  return (
    <>
      <PageHeader title={job.serviceNumber} subtitle={job.serviceType}><StatusBadge status={job.status} /></PageHeader>
      <div className="max-w-2xl space-y-4">
        <WorkerActions jobId={job.id} status={job.status} />
        <VoiceStatus jobId={job.id} options={workerNextStatuses(job.status)} />
        <Section
          title="Parts and extra work"
          action={canEdit && <WorkItemDialog jobId={job.id} {...catalog} trigger={<><Plus className="size-3.5" /> Add issue, service or part</>} />}
        >
          {canEdit && <p className="mb-3 text-sm text-muted-foreground">Extra work goes to the customer on WhatsApp, and joins the bill when they say yes.</p>}
          {!canEdit && !isTerminal(job.status) && <p className="mb-3 text-sm text-muted-foreground">The bill is with the customer. Ask reception to change it.</p>}
          <SimpleTable
            headers={["Item", "Qty", "Cost", ""]}
            empty="Nothing added yet"
            rowKeys={job.items.map((i) => i.id)}
            rows={job.items.map((i) => [
              <div key="n">{i.name}<ApprovalBadge approval={i.approval} /></div>,
              Number(i.quantity),
              money(i.total),
              canEdit && (
                <WorkItemDialog key="x" jobId={job.id} item={toWorkItem(i)} {...catalog} variant="ghost" triggerSize="icon-sm" triggerLabel={`Edit ${i.name}`} trigger={<Pencil className="size-3.5" />} />
              ),
            ])}
          />
          {job.items.length > 0 && <p className="mt-3 text-right text-sm font-semibold">Approved total: {money(job.items.filter((i) => i.approval === "APPROVED").reduce((sum, i) => sum + Number(i.total), 0))}</p>}
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
