"use client";

import type { Priority, ServiceStatus } from "@prisma/client";
import { CalendarClock, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormDialog, SELECT_CLASS, type FormField } from "@/components/actions";
import { jobEditFields } from "@/components/forms-config";
import { TextLink } from "@/components/ui-kit";
import { VoiceStatus } from "@/components/voice-status";
import { api } from "@/lib/client";
import { workerLoadLabel } from "@/lib/format";
import { boardTargets, isTerminal, STATUS_COLOR, STATUS_LABEL, STATUSES } from "@/lib/status";
import { cn } from "@/lib/utils";

export type BoardJob = {
  id: string;
  serviceNumber: string;
  serviceType: string;
  status: ServiceStatus;
  priority: Priority;
  customerName: string;
  registrationNumber: string;
  vehicleName: string;
  workerId: string | null;
  workerName: string | null;
  estimate: string;
  /** Booked time, already formatted on the server so it can't differ between server and browser. */
  appointment: string | null;
  /** The values the edit form starts from. */
  edit: {
    customerComplaint: string | null;
    internalNotes: string | null;
    estimatedAmount: string | null;
    appointmentDate: string | null;
    expectedCompletion: string | null;
  };
};

const PRIORITY_COLOR: Partial<Record<Priority, string>> = {
  HIGH: "bg-amber-100 text-amber-800",
  URGENT: "bg-red-100 text-red-700",
};

export function JobBoard({ jobs, counts, base, workers, serviceTypes }: {
  jobs: BoardJob[];
  /** Totals per status, which can exceed the cards loaded. */
  counts: Partial<Record<ServiceStatus, number>>;
  base: string;
  workers: { id: string; name: string; activeJobs: number; onLeave: boolean }[];
  serviceTypes: string[];
}) {
  const router = useRouter();
  const [moved, setMoved] = useState<Record<string, ServiceStatus>>({});
  const [assigned, setAssigned] = useState<Record<string, { id: string; name: string }>>({});
  const [dragging, setDragging] = useState<BoardJob | null>(null);
  const [over, setOver] = useState<ServiceStatus | null>(null);

  // Fresh server data replaces any optimistic moves.
  useEffect(() => {
    setMoved({});
    setAssigned({});
  }, [jobs]);

  const current = jobs.map((j) => ({
    ...j,
    status: moved[j.id] ?? j.status,
    workerId: assigned[j.id]?.id ?? j.workerId,
    workerName: assigned[j.id]?.name ?? j.workerName,
  }));
  const dropTargets = dragging ? boardTargets(dragging.status) : [];

  const totals = { ...counts };
  for (const j of jobs) {
    const to = moved[j.id];
    if (to && to !== j.status) {
      totals[j.status] = (totals[j.status] ?? 0) - 1;
      totals[to] = (totals[to] ?? 0) + 1;
    }
  }

  async function move(job: BoardJob, to: ServiceStatus) {
    if (to === "CANCELLED" && !window.confirm(`Cancel ${job.serviceNumber}? The customer will be told on WhatsApp.`)) return;
    if (to === "COMPLETED" && !window.confirm(`Complete ${job.serviceNumber}? The customer will be told on WhatsApp.`)) return;
    setMoved((m) => ({ ...m, [job.id]: to }));
    try {
      await api(`/api/service-jobs/${job.id}/status`, { method: "POST", body: { status: to } });
      toast.success(`${job.serviceNumber} moved to ${STATUS_LABEL[to]}`);
    } catch (err) {
      setMoved(({ [job.id]: _reverted, ...rest }) => rest);
      toast.error((err as Error).message);
    }
    router.refresh();
  }

  async function assign(job: BoardJob, workerId: string) {
    const worker = workers.find((w) => w.id === workerId);
    if (!worker) return;
    setAssigned((a) => ({ ...a, [job.id]: { id: worker.id, name: worker.name } }));
    if (job.status === "NEW") setMoved((m) => ({ ...m, [job.id]: "ASSIGNED" }));
    try {
      await api(`/api/service-jobs/${job.id}/assign`, { method: "POST", body: { workerId } });
      toast.success(`${job.serviceNumber} assigned to ${worker.name}`);
    } catch (err) {
      setAssigned(({ [job.id]: _reverted, ...rest }) => rest);
      setMoved(({ [job.id]: _reverted, ...rest }) => rest);
      toast.error((err as Error).message);
    }
    router.refresh();
  }

  const editFields = (job: BoardJob): FormField[] => [
    {
      name: "serviceType",
      label: "Service type",
      type: "select",
      required: true,
      options: [...new Set([job.serviceType, ...serviceTypes])].map((t) => ({ value: t, label: t })),
    },
    ...jobEditFields,
  ];

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-4">
      {STATUSES.map((status) => {
        const cards = current.filter((j) => j.status === status);
        const total = totals[status] ?? 0;
        const droppable = dragging !== null && dropTargets.includes(status);
        return (
          <section
            key={status}
            aria-label={STATUS_LABEL[status]}
            onDragOver={(e) => {
              if (!droppable) return;
              e.preventDefault();
              setOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              // Moving the card unmounts it, so its own drag-end event never arrives.
              setDragging(null);
              if (dragging && droppable) void move(dragging, status);
            }}
            className={cn(
              "w-64 shrink-0 rounded-lg border bg-muted/40 p-2 transition-opacity",
              dragging && !droppable && dragging.status !== status && "opacity-40",
              droppable && "border-dashed border-primary",
              over === status && "bg-accent",
            )}
          >
            <header className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_COLOR[status])}>{STATUS_LABEL[status]}</span>
              <span className="text-xs font-medium text-muted-foreground tabular-nums">{total}</span>
            </header>
            <div className="min-h-16 space-y-2">
              {cards.map((job) => {
                const targets = boardTargets(job.status);
                return (
                  <article
                    key={job.id}
                    draggable={targets.length > 0}
                    onDragStart={(e) => {
                      // The edit form is a portal, so its events bubble here too. Only drags from the card itself count.
                      if (!e.currentTarget.contains(e.target as Node)) return;
                      // Some browsers start a card drag from a dropdown instead of opening it.
                      if ((e.target as Element).closest?.("select, input, textarea, button")) {
                        e.preventDefault();
                        return;
                      }
                      e.dataTransfer.setData("text/plain", job.serviceNumber);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(job);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cn("space-y-1 rounded-lg border bg-card p-2.5 text-sm shadow-xs", targets.length > 0 && "cursor-grab active:cursor-grabbing")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <TextLink href={`${base}/jobs/${job.id}`}>{job.serviceNumber}</TextLink>
                      <div className="flex shrink-0 items-center gap-1">
                        {PRIORITY_COLOR[job.priority] && (
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", PRIORITY_COLOR[job.priority])}>{job.priority.charAt(0) + job.priority.slice(1).toLowerCase()}</span>
                        )}
                        <FormDialog
                          trigger={<Pencil className="size-3.5" />}
                          triggerLabel={`Edit ${job.serviceNumber}`}
                          triggerSize="icon-sm"
                          variant="ghost"
                          title={`Edit ${job.serviceNumber}`}
                          method="PATCH"
                          endpoint={`/api/service-jobs/${job.id}`}
                          fields={editFields(job)}
                          initial={{ ...job.edit, serviceType: job.serviceType, priority: job.priority }}
                          success="Job updated"
                        />
                      </div>
                    </div>
                    <p className="font-medium break-words">{job.customerName}</p>
                    <p className="text-xs break-words text-muted-foreground">{job.registrationNumber} · {job.vehicleName}</p>
                    <p className="text-xs break-words text-muted-foreground">{job.serviceType}</p>
                    {job.appointment && <p className="flex items-center gap-1 text-xs font-medium text-primary"><CalendarClock aria-hidden className="size-3 shrink-0" />Booked {job.appointment}</p>}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1">
                        {job.workerName ? <span className="min-w-0 truncate">{job.workerName}</span> : <span className="text-amber-700">Unassigned</span>}
                        {!isTerminal(job.status) && workers.some((w) => w.id === job.workerId && w.onLeave) && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[0.7rem] font-medium text-amber-800">On leave</span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums">{job.estimate}</span>
                    </div>
                    {targets.length > 0 && <VoiceStatus compact jobId={job.id} options={targets.filter((t) => t !== "CANCELLED")} />}
                    {!isTerminal(job.status) && (
                      <select
                        aria-label={`Assign ${job.serviceNumber}`}
                        className={cn(SELECT_CLASS, "mt-1 h-7 text-xs")}
                        value={job.workerId ?? ""}
                        onChange={(e) => void assign(job, e.target.value)}
                      >
                        {!job.workerId && <option value="">{workers.length ? "Assign worker…" : "No active workers"}</option>}
                        {job.workerId && !workers.some((w) => w.id === job.workerId) && <option value={job.workerId}>{job.workerName}</option>}
                        {workers.map((w) => <option key={w.id} value={w.id}>{workerLoadLabel(w)}</option>)}
                      </select>
                    )}
                    {targets.length > 0 && (
                      <select
                        aria-label={`Move ${job.serviceNumber}`}
                        className={cn(SELECT_CLASS, "mt-1 h-7 text-xs")}
                        value=""
                        onChange={(e) => void move(job, e.target.value as ServiceStatus)}
                      >
                        <option value="">Move to…</option>
                        {targets.map((t) => <option key={t} value={t}>{STATUS_LABEL[t]}</option>)}
                      </select>
                    )}
                  </article>
                );
              })}
              {total > cards.length && <p className="px-1 text-xs text-muted-foreground">Showing {cards.length} of {total}. Search to find others.</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
