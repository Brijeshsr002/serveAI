"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SELECT_CLASS } from "@/components/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client";
import { workerLoadLabel } from "@/lib/format";

type Customer = { id: string; name: string; phone: string; vehicles: { id: string; label: string }[] };

export function NewJobDialog({
  customers, serviceTypes, workers, base, presetCustomerId, presetVehicleId, rates = {},
}: {
  customers: Customer[];
  serviceTypes: string[];
  workers: { id: string; name: string; activeJobs: number; onLeave?: boolean }[];
  base: string;
  presetCustomerId?: string;
  presetVehicleId?: string;
  /** Service name to default price. */
  rates?: Record<string, number>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState(presetCustomerId ?? "");
  const [filter, setFilter] = useState("");
  const [estimate, setEstimate] = useState(serviceTypes[0] && rates[serviceTypes[0]] !== undefined ? String(rates[serviceTypes[0]]) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const needle = filter.toLowerCase();
  const visible = customers.filter((c) => !needle || c.id === customerId || c.name.toLowerCase().includes(needle) || c.phone.includes(needle));
  const vehicles = customers.find((c) => c.id === customerId)?.vehicles ?? [];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const when = String(f.get("appointmentDate") ?? "");
    const due = String(f.get("expectedCompletion") ?? "");
    setBusy(true);
    setError("");
    try {
      const job = await api<{ id: string }>("/api/service-jobs", {
        method: "POST",
        body: {
          customerId,
          vehicleId: f.get("vehicleId"),
          serviceType: f.get("serviceType"),
          customerComplaint: f.get("customerComplaint"),
          internalNotes: f.get("internalNotes"),
          estimatedAmount: f.get("estimatedAmount"),
          priority: f.get("priority"),
          assignedWorkerId: f.get("assignedWorkerId") || null,
          appointmentDate: when ? new Date(when).toISOString() : null,
          expectedCompletion: due ? new Date(due).toISOString() : null,
        },
      });
      toast.success("Service job created");
      setOpen(false);
      router.push(`${base}/jobs/${job.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>+ New service job</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New service job</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="customerId">Customer *</Label>
              <Link href={`${base}/customers`} className="text-xs font-medium text-primary hover:underline">+ New customer</Link>
            </div>
            <Input aria-label="Filter customers" placeholder="Filter by name or phone" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <select id="customerId" required className={SELECT_CLASS} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select customer…</option>
              {visible.map((c) => <option key={c.id} value={c.id}>{c.name} · +{c.phone}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="vehicleId">Vehicle *</Label>
            <select id="vehicleId" name="vehicleId" required defaultValue={presetVehicleId} key={customerId} className={SELECT_CLASS}>
              {vehicles.length === 0 && <option value="">{customerId ? "This customer has no vehicles yet" : "Select a customer first"}</option>}
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="serviceType">Service type *</Label>
            <select id="serviceType" name="serviceType" required className={SELECT_CLASS} onChange={(e) => setEstimate(rates[e.target.value] !== undefined ? String(rates[e.target.value]) : "")}>
              {serviceTypes.map((t) => <option key={t} value={t}>{t}{rates[t] !== undefined ? ` (₹${rates[t]})` : ""}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="customerComplaint">Customer complaint</Label>
            <Textarea id="customerComplaint" name="customerComplaint" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="estimatedAmount">Estimated cost (₹)</Label>
              <Input id="estimatedAmount" name="estimatedAmount" type="number" min={0} step="any" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="priority">Priority</Label>
              <select id="priority" name="priority" defaultValue="NORMAL" className={SELECT_CLASS}>
                {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="appointmentDate">Appointment</Label>
              <Input id="appointmentDate" name="appointmentDate" type="datetime-local" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="expectedCompletion">Expected completion</Label>
              <Input id="expectedCompletion" name="expectedCompletion" type="datetime-local" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="assignedWorkerId">Assign worker</Label>
            <select id="assignedWorkerId" name="assignedWorkerId" className={SELECT_CLASS}>
              <option value="">Assign later</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{workerLoadLabel(w)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="internalNotes">Internal notes (not shown to customer)</Label>
            <Textarea id="internalNotes" name="internalNotes" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create service job"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
