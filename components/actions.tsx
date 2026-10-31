"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client";

export const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type FormField = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "number" | "textarea" | "select" | "datetime-local" | "password" | "checkbox";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  /** Leave out of the request when blank, e.g. "new password" on an edit form. */
  omitEmpty?: boolean;
};

type Variant = "default" | "outline" | "secondary" | "ghost" | "destructive";

function toLocalInput(value: unknown) {
  if (!value) return "";
  const d = new Date(value as string);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function FormDialog({
  trigger, title, endpoint, method = "POST", fields, initial = {}, submitLabel = "Save", success = "Saved", variant = "default", redirectTo,
}: {
  trigger: string;
  title: string;
  endpoint: string;
  method?: "POST" | "PATCH";
  fields: FormField[];
  initial?: Record<string, unknown>;
  submitLabel?: string;
  success?: string;
  variant?: Variant;
  /** ":id" is replaced with the created record's id. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === "checkbox") {
        body[f.name] = form.get(f.name) === "on";
        continue;
      }
      const value = String(form.get(f.name) ?? "");
      if (f.omitEmpty && !value) continue;
      body[f.name] = f.type === "datetime-local" && value ? new Date(value).toISOString() : value;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api<{ id?: string }>(endpoint, { method, body });
      toast.success(success);
      setOpen(false);
      if (redirectTo) router.push(redirectTo.replace(":id", data?.id ?? ""));
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={variant} size="sm" />}>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {fields.map((f) => <FieldInput key={f.name} field={f} value={initial[f.name]} />)}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldInput({ field: f, value }: { field: FormField; value: unknown }) {
  const id = `f-${f.name}`;
  const text = value === null || value === undefined ? "" : String(value);
  if (f.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={f.name} defaultChecked={Boolean(value)} /> {f.label}
      </label>
    );
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
      {f.type === "textarea" ? (
        <Textarea id={id} name={f.name} defaultValue={text} required={f.required} placeholder={f.placeholder} />
      ) : f.type === "select" ? (
        <select id={id} name={f.name} defaultValue={text} required={f.required} className={SELECT_CLASS}>
          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <Input
          id={id}
          name={f.name}
          type={f.type ?? "text"}
          step={f.type === "number" ? "any" : undefined}
          min={f.type === "number" ? 0 : undefined}
          defaultValue={f.type === "datetime-local" ? toLocalInput(value) : text}
          required={f.required}
          placeholder={f.placeholder}
        />
      )}
    </div>
  );
}

export function ActionButton({
  label, endpoint, method = "POST", body, confirm, success, variant = "default", size = "sm", openKey, className,
}: {
  label: string;
  endpoint: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  confirm?: string;
  success?: string;
  variant?: Variant;
  size?: "sm" | "default" | "lg";
  /** Send the browser to this key of the response, e.g. a payment link. */
  openKey?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    try {
      const data = await api<Record<string, string>>(endpoint, { method, body: body ?? (method === "DELETE" ? undefined : {}) });
      if (openKey && data?.[openKey]) {
        window.location.href = data[openKey];
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <Button variant={variant} size={size} disabled={busy} onClick={run} className={className}>{busy ? "Working…" : label}</Button>;
}

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"), () => toast.error("Couldn't copy"))}
    >
      {label}
    </Button>
  );
}

export function AssignControl({ jobId, workers, current }: { jobId: string; workers: { id: string; name: string; activeJobs: number }[]; current: string | null }) {
  const router = useRouter();
  const [workerId, setWorkerId] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  async function assign() {
    setBusy(true);
    try {
      await api(`/api/service-jobs/${jobId}/assign`, { method: "POST", body: { workerId } });
      toast.success("Worker assigned");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex gap-2">
      <select aria-label="Assign worker" className={SELECT_CLASS} value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
        <option value="">Select worker…</option>
        {workers.map((w) => (
          <option key={w.id} value={w.id}>{w.name} — {w.activeJobs} active job{w.activeJobs === 1 ? "" : "s"}</option>
        ))}
      </select>
      <Button size="sm" disabled={busy || !workerId || workerId === current} onClick={assign}>{current ? "Reassign" : "Assign"}</Button>
    </div>
  );
}
