"use client";

import type { Priority, ServiceStatus } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SELECT_CLASS } from "@/components/actions";
import { TextLink } from "@/components/ui-kit";
import { api } from "@/lib/client";
import { boardTargets, STATUS_COLOR, STATUS_LABEL, STATUSES } from "@/lib/status";
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
  workerName: string | null;
  estimate: string;
};

const PRIORITY_COLOR: Partial<Record<Priority, string>> = {
  HIGH: "bg-amber-100 text-amber-800",
  URGENT: "bg-red-100 text-red-700",
};

export function JobBoard({ jobs, counts, base, role }: {
  jobs: BoardJob[];
  /** Totals per status, which can exceed the cards loaded. */
  counts: Partial<Record<ServiceStatus, number>>;
  base: string;
  role: "ADMIN" | "RECEPTIONIST";
}) {
  const router = useRouter();
  const [moved, setMoved] = useState<Record<string, ServiceStatus>>({});
  const [dragging, setDragging] = useState<BoardJob | null>(null);
  const [over, setOver] = useState<ServiceStatus | null>(null);

  // Fresh server data replaces any optimistic moves.
  useEffect(() => setMoved({}), [jobs]);

  const current = jobs.map((j) => ({ ...j, status: moved[j.id] ?? j.status }));
  const dropTargets = dragging ? boardTargets(role, dragging.status) : [];

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
                const targets = boardTargets(role, job.status);
                return (
                  <article
                    key={job.id}
                    draggable={targets.length > 0}
                    onDragStart={(e) => {
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
                      {PRIORITY_COLOR[job.priority] && (
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", PRIORITY_COLOR[job.priority])}>{job.priority.charAt(0) + job.priority.slice(1).toLowerCase()}</span>
                      )}
                    </div>
                    <p className="font-medium break-words">{job.customerName}</p>
                    <p className="text-xs break-words text-muted-foreground">{job.registrationNumber} · {job.vehicleName}</p>
                    <p className="text-xs break-words text-muted-foreground">{job.serviceType}</p>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      {job.workerName ? <span className="min-w-0 truncate">{job.workerName}</span> : <span className="text-amber-700">Unassigned</span>}
                      <span className="shrink-0 tabular-nums">{job.estimate}</span>
                    </div>
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
