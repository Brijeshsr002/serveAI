import { Download } from "lucide-react";
import { ActionButton, AssignControl, CopyButton, FormDialog } from "@/components/actions";
import { itemFields, jobEditFields } from "@/components/forms-config";
import { ApprovalBadge, Field, PageHeader, PaymentBadge, Section, SimpleTable, StatusBadge, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { dateTime, money, time } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { getJobForUser, workersWithLoad } from "@/lib/services/jobs";
import { activePartNames, billPrices } from "@/lib/services/service-rates";
import { trackingUrl } from "@/lib/settings";
import { WorkItemDialog } from "@/components/work-item-dialog";
import { boardTargets, isTerminal, STATUS_LABEL, STATUSES } from "@/lib/status";
import { VoiceStatus } from "@/components/voice-status";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const { id } = await params;
  const job = await getJobForUser(user, id).catch(() => null);
  if (!job) return <p className="text-muted-foreground">Service job not found</p>;

  const [workers, activity] = await Promise.all([
    workersWithLoad(),
    db.activityLog.findMany({
      where: { OR: [{ entityType: "ServiceJob", entityId: id }, { entityType: "Payment", entityId: { in: job.payments.map((p) => p.id) } }] },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const paid = job.payments.some((p) => p.status === "PAID");
  const openPayment = job.payments.find((p) => p.status === "PENDING" || p.status === "PROCESSING");
  const itemsTotal = job.items.filter((i) => i.approval === "APPROVED").reduce((sum, i) => sum + Number(i.total), 0);
  const closed = isTerminal(job.status);
  const prices = await billPrices();
  const parts = await activePartNames();

  return (
    <>
      <PageHeader title={job.serviceNumber} subtitle={`${job.serviceType} · ${job.customer.name}`}>
        <StatusBadge status={job.status} />
        <CopyButton text={trackingUrl(job.trackingToken)} label="Copy tracking link" />
        <FormDialog trigger="Edit" title="Edit service job" variant="outline" method="PATCH" endpoint={`/api/service-jobs/${job.id}`} fields={jobEditFields} initial={{ customerComplaint: job.customerComplaint, internalNotes: job.internalNotes, estimatedAmount: job.estimatedAmount?.toString(), priority: job.priority, appointmentDate: job.appointmentDate, expectedCompletion: job.expectedCompletion }} />
        {!closed && <ActionButton label="Cancel job" variant="destructive" endpoint={`/api/service-jobs/${job.id}/status`} body={{ status: "CANCELLED" }} confirm={`Cancel ${job.serviceNumber}? The customer will be told on WhatsApp.`} success="Job cancelled" />}
        {user.role === "ADMIN" && (
          <FormDialog
            trigger="Override status"
            title="Override status (logged)"
            variant="outline"
            endpoint={`/api/service-jobs/${job.id}/status`}
            success="Status overridden"
            fields={[
              { name: "status", label: "New status", type: "select", required: true, options: STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
              { name: "notes", label: "Reason", type: "textarea", required: true },
              { name: "override", label: "I understand this bypasses the workflow rules", type: "checkbox" },
            ]}
          />
        )}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <VoiceStatus jobId={job.id} options={boardTargets(job.status).filter((s) => s !== "CANCELLED")} />
          <Section title="Details">
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="Customer"><TextLink href={`${base}/customers/${job.customer.id}`}>{job.customer.name}</TextLink></Field>
              <Field label="Phone">+{job.customer.phone}</Field>
              <Field label="Vehicle"><TextLink href={`${base}/vehicles/${job.vehicle.id}`}>{job.vehicle.registrationNumber}</TextLink> · {job.vehicle.brand} {job.vehicle.model}</Field>
              <Field label="Priority">{job.priority}</Field>
              <Field label="Appointment">{dateTime(job.appointmentDate)}</Field>
              <Field label="Expected completion">{dateTime(job.expectedCompletion)}</Field>
              <Field label="Estimated">{money(job.estimatedAmount)}</Field>
              <Field label="Final">{money(job.finalAmount)}</Field>
              <Field label="Completed">{dateTime(job.actualCompletion)}</Field>
              <div className="col-span-full"><Field label="Customer complaint">{job.customerComplaint}</Field></div>
              <div className="col-span-full"><Field label="Internal notes">{job.internalNotes}</Field></div>
            </dl>
          </Section>

          <Section
            title="Service items"
            action={!paid && <WorkItemDialog staff jobId={job.id} prices={prices} parts={parts} variant="outline" trigger="+ Add item" />}
          >
            <SimpleTable
              headers={["Item", "Type", "Qty", "Price", "Tax", "Discount", "Total", ""]}
              empty="No items yet. Add parts and labour to build the invoice."
              rows={job.items.map((i) => [
                <div key="n">{i.name}<ApprovalBadge approval={i.approval} /></div>,
                i.itemType.toLowerCase(),
                Number(i.quantity),
                money(i.unitPrice),
                money(i.tax),
                money(i.discount),
                money(i.total),
                !paid && (
                  <div key="x" className="flex flex-wrap gap-1">
                    {i.approval === "PENDING" && <ActionButton label="Customer said yes" variant="outline" endpoint={`/api/service-jobs/${job.id}/items/${i.id}/approval`} body={{ approve: true }} success="Added to the bill" />}
                    {i.approval === "PENDING" && <ActionButton label="Customer said no" variant="ghost" endpoint={`/api/service-jobs/${job.id}/items/${i.id}/approval`} body={{ approve: false }} success="Marked as declined" />}
                    <FormDialog trigger="Edit" title={`Edit ${i.name}`} variant="ghost" method="PATCH" endpoint={`/api/service-jobs/${job.id}/items/${i.id}`} fields={itemFields} initial={{ itemType: i.itemType, name: i.name, description: i.description, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), tax: Number(i.tax), discount: Number(i.discount), notifyCustomer: true }} success="Item updated" />
                    <ActionButton label="Remove" variant="ghost" method="DELETE" endpoint={`/api/service-jobs/${job.id}/items/${i.id}?notify=1`} confirm={`Remove ${i.name}? The customer will be told on WhatsApp.`} />
                  </div>
                ),
              ])}
            />
            {job.items.length > 0 && <p className="mt-3 text-right text-sm font-semibold">Total: {money(itemsTotal)}</p>}
          </Section>

          <Section title="Invoice and payment">
            <div className="space-y-3 text-sm">
              {job.invoice ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{job.invoice.invoiceNumber}</span>
                  <span>{money(job.invoice.total)}</span>
                  <a className="text-primary hover:underline" href={`/api/invoices/${job.invoice.id}/pdf`}><Download className="mr-1 inline size-3.5" />Download PDF</a>
                  <ActionButton label="Send on WhatsApp" variant="outline" endpoint={`/api/invoices/${job.invoice.id}/send`} success="Invoice sent" />
                  {!paid && <ActionButton label="Update invoice" variant="outline" endpoint="/api/invoices" body={{ serviceJobId: job.id }} success="Invoice updated" />}
                </div>
              ) : (
                <ActionButton label="Generate invoice" endpoint="/api/invoices" body={{ serviceJobId: job.id }} success="Invoice generated" />
              )}
              {job.invoice && !paid && job.status !== "CANCELLED" && (
                <div className="flex flex-wrap items-center gap-2">
                  <ActionButton label={openPayment ? "Resend payment link" : "Create payment request"} endpoint="/api/payments/create" body={{ serviceJobId: job.id, notifyCustomer: true }} success="Payment link ready" />
                  {openPayment?.paymentLink && <CopyButton text={openPayment.paymentLink} label="Copy payment link" />}
                </div>
              )}
              <SimpleTable
                headers={["Amount", "Provider", "Status", "Paid", "Created"]}
                empty="No payment requests yet"
                rows={job.payments.map((p) => [money(p.amount), p.paymentProvider, <PaymentBadge key="b" status={p.status} />, dateTime(p.paidAt), dateTime(p.createdAt)])}
              />
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Assign worker">
            {closed ? <p className="text-sm">{job.assignedWorker?.name ?? "Not assigned"}</p> : <AssignControl jobId={job.id} workers={workers} current={job.assignedWorkerId} />}
          </Section>
          <Section title="Activity timeline" action={<TextLink href={`${base}/whatsapp?c=${job.customer.id}`}>WhatsApp</TextLink>}>
            <ol className="space-y-3 border-l pl-3 text-sm">
              {activity.map((a) => (
                <li key={a.id}>
                  <p className="text-xs text-muted-foreground">{time(a.createdAt)} · {dateTime(a.createdAt).split(",")[0]}</p>
                  <p>{a.summary}</p>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
    </>
  );
}
