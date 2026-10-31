import { ActionButton, AssignControl, CopyButton, FormDialog } from "@/components/actions";
import { itemFields, jobEditFields } from "@/components/forms-config";
import { Field, PageHeader, PaymentBadge, Section, SimpleTable, StatusBadge, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { dateTime, money, time } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { getJobForUser, workersWithLoad } from "@/lib/services/jobs";
import { trackingUrl } from "@/lib/settings";
import { isTerminal, STATUS_LABEL, STATUSES } from "@/lib/status";

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
  const itemsTotal = job.items.reduce((sum, i) => sum + Number(i.total), 0);
  const closed = isTerminal(job.status);

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
            action={!paid && <FormDialog trigger="Add item" title="Add service item" variant="outline" endpoint={`/api/service-jobs/${job.id}/items`} fields={itemFields} initial={{ quantity: 1, tax: 0, discount: 0, itemType: "PART" }} success="Item added" />}
          >
            <SimpleTable
              headers={["Item", "Type", "Qty", "Price", "Tax", "Discount", "Total", ""]}
              empty="No items yet. Add parts and labour to build the invoice."
              rows={job.items.map((i) => [
                i.name,
                i.itemType.toLowerCase(),
                Number(i.quantity),
                money(i.unitPrice),
                money(i.tax),
                money(i.discount),
                money(i.total),
                !paid && <ActionButton key="x" label="Remove" variant="ghost" method="DELETE" endpoint={`/api/service-jobs/${job.id}/items/${i.id}`} />,
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
                  <a className="text-primary hover:underline" href={`/api/invoices/${job.invoice.id}/pdf`}>Download PDF</a>
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
