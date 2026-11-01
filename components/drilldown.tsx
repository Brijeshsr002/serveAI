"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleTable, StatusBadge, TextLink } from "@/components/ui-kit";
import { api } from "@/lib/client";
import type { Drilldown } from "@/lib/services/reports";

export type DrillQuery = { kind: "status" | "type" | "day" | "month" | "worker"; value: string; bucket?: "completed" | "active"; label: string };

function Records({ data }: { data: Drilldown }) {
  const capped = data.count > data.rows.length && <p className="text-xs text-muted-foreground">Showing the first {data.rows.length} of {data.count}.</p>;
  if (data.type === "payments") {
    return (
      <>
        <p className="text-base font-semibold tabular-nums">{data.totalLabel} <span className="text-sm font-normal text-muted-foreground">from {data.count} payment{data.count === 1 ? "" : "s"}</span></p>
        {capped}
        <SimpleTable
          headers={["Paid", "Service", "Customer", "Provider", "Amount"]}
          empty="No payments for this period"
          rows={data.rows.map((p) => [
            p.paidAt,
            <div key="s"><TextLink href={`/admin/jobs/${p.jobId}`}>{p.serviceNumber}</TextLink><div className="text-xs text-muted-foreground">{p.serviceType}</div></div>,
            <div key="c">{p.customerName}<div className="text-xs text-muted-foreground">+{p.phone}</div></div>,
            p.provider,
            p.amount,
          ])}
        />
      </>
    );
  }
  return (
    <>
      <p className="text-sm text-muted-foreground">{data.count} job{data.count === 1 ? "" : "s"}</p>
      {capped}
      <SimpleTable
        headers={["Service", "Customer", "Vehicle", "Status", "Worker", "Amount", "Created"]}
        empty="No jobs here"
        rows={data.rows.map((j) => [
          <div key="s"><TextLink href={`/admin/jobs/${j.id}`}>{j.serviceNumber}</TextLink><div className="text-xs text-muted-foreground">{j.serviceType}</div></div>,
          <div key="c">{j.customerName}<div className="text-xs text-muted-foreground">+{j.phone}</div></div>,
          <div key="v">{j.registrationNumber}<div className="text-xs text-muted-foreground">{j.vehicleName}</div></div>,
          <StatusBadge key="b" status={j.status} />,
          j.workerName ?? "—",
          j.amount,
          j.created,
        ])}
      />
    </>
  );
}

/** Base UI only hands focus back to HTML elements, so a revenue bar, being SVG, gets it back here. */
export function useDrill() {
  const [query, setQuery] = useState<DrillQuery | null>(null);
  const opener = useRef<Element | null>(null);
  const open = useCallback((next: DrillQuery) => {
    opener.current = document.activeElement;
    setQuery(next);
  }, []);
  return {
    open,
    dialog: (
      <DrillDialog
        query={query}
        onClose={() => setQuery(null)}
        onClosed={() => {
          if (opener.current instanceof SVGElement && opener.current.isConnected) opener.current.focus();
        }}
      />
    ),
  };
}

/** The records behind a chart bar, loaded when it's opened. */
function DrillDialog({ query, onClose, onClosed }: { query: DrillQuery | null; onClose: () => void; onClosed: () => void }) {
  const [data, setData] = useState<Drilldown | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!query) return;
    let stale = false;
    setData(null);
    setError("");
    const params = new URLSearchParams({ kind: query.kind, value: query.value, ...(query.bucket ? { bucket: query.bucket } : {}) });
    api<Drilldown>(`/api/reports/drilldown?${params}`).then(
      (result) => { if (!stale) setData(result); },
      (err: Error) => { if (!stale) setError(err.message); },
    );
    return () => { stale = true; };
  }, [query, attempt]);

  return (
    <Dialog open={query !== null} onOpenChange={(next) => { if (!next) onClose(); }} onOpenChangeComplete={(next) => { if (!next) onClosed(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader><DialogTitle>{data?.title ?? query?.label}</DialogTitle></DialogHeader>
        {!data && !error && <p role="status" className="py-8 text-center text-muted-foreground">Loading…</p>}
        {error && (
          <div role="alert" className="space-y-2 text-destructive">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </div>
        )}
        {data && <Records data={data} />}
      </DialogContent>
    </Dialog>
  );
}
