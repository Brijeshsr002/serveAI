"use client";

import { Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, PaymentBadge, SimpleTable, StatusBadge, TextLink } from "@/components/ui-kit";
import { api } from "@/lib/client";
import type { CustomerOverview } from "@/lib/services/customers";

type Job = CustomerOverview["activeJobs"][number];

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-1 text-sm font-semibold">{children}</h3>;
}

function JobsTable({ jobs, base, empty }: { jobs: Job[]; base: string; empty: string }) {
  return (
    <SimpleTable
      headers={["Service", "Vehicle", "Type", "Status", "Worker", "Amount"]}
      empty={empty}
      rows={jobs.map((j) => [
        <div key="s"><TextLink href={`${base}/jobs/${j.id}`}>{j.serviceNumber}</TextLink><div className="text-xs text-muted-foreground">{j.appointment ? `Booked ${j.appointment}` : j.created}</div></div>,
        j.registrationNumber,
        j.serviceType,
        <StatusBadge key="b" status={j.status} />,
        j.workerName ?? "—",
        j.amount,
      ])}
    />
  );
}

/** Loaded when opened, so a page of customers doesn't carry everyone's full record. */
export function CustomerViewButton({ id, name, base }: { id: string; name: string; base: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CustomerOverview | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setError("");
    api<CustomerOverview>(`/api/customers/${id}/overview`).then(
      (result) => { if (!stale) setData(result); },
      (err: Error) => { if (!stale) setError(err.message); },
    );
    return () => { stale = true; };
  }, [open, id, attempt]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`View ${name}`} title={`View ${name}`} />}><Eye className="size-3.5" /></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{name}</DialogTitle></DialogHeader>
        {error && (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </div>
        )}
        {!data && !error && <p role="status" className="py-6 text-center text-muted-foreground">Loading…</p>}
        {data && !error && (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Customer ID">{data.customerCode}</Field>
              <Field label="Phone">+{data.phone}</Field>
              <Field label="Email">{data.email}</Field>
              <Field label="Address">{data.address}</Field>
              <Field label="City">{data.city}</Field>
              <div className="col-span-2 sm:col-span-3"><Field label="Notes"><span className="whitespace-pre-wrap">{data.notes}</span></Field></div>
            </dl>
            <Heading>Vehicles</Heading>
            <SimpleTable
              headers={["Registration", "Vehicle", "Details"]}
              empty="No vehicles yet"
              rows={data.vehicles.map((v) => [<TextLink key="r" href={`${base}/vehicles/${v.id}`}>{v.registrationNumber}</TextLink>, v.name, v.details || "—"])}
            />
            <Heading>Active jobs</Heading>
            <JobsTable jobs={data.activeJobs} base={base} empty="No active jobs" />
            <Heading>Recent jobs</Heading>
            <JobsTable jobs={data.recentJobs} base={base} empty="No finished jobs yet" />
            <Heading>Payments</Heading>
            <dl className="grid grid-cols-3 gap-3">
              <Field label="Latest">{data.payment.latestStatus ? <PaymentBadge status={data.payment.latestStatus} /> : "No payments yet"}</Field>
              <Field label="Due">{data.payment.due}</Field>
              <Field label="Paid">{data.payment.paid}</Field>
            </dl>
            {data.payment.rows.length > 0 && (
              <SimpleTable
                headers={["Service", "Amount", "Status", "When"]}
                rows={data.payment.rows.map((p) => [
                  <TextLink key="s" href={`${base}/jobs/${p.jobId}`}>{p.serviceNumber}</TextLink>,
                  p.amount,
                  <PaymentBadge key="b" status={p.status} />,
                  p.when,
                ])}
              />
            )}
            <p><TextLink href={`${base}/customers/${data.id}`}>Open full page</TextLink></p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
