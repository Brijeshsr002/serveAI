"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client";
import { fill, MESSAGE_STEPS, type MessageStep } from "@/lib/message-steps";
import { cn } from "@/lib/utils";

const SAMPLE: Record<string, string> = {
  customer_name: "Brijesh",
  service_number: "SRV-2026-000123",
  vehicle_model: "Hyundai Creta",
  registration: "TN38AB1234",
  tracking_link: "https://your-garage.example/track/…",
  garage_phone: "+91 98765 43210",
  item_name: "Brake Pads",
  item_cost: "₹1,800",
  bill_total: "₹4,300",
  amount: "₹4,300",
  payment_link: "https://rzp.io/i/…",
  invoice_number: "INV-2026-000045",
};

const GROUPS = [...new Set(MESSAGE_STEPS.map((s) => s.group))];

export function MessageEditor({ values }: { values: Record<string, string> }) {
  const router = useRouter();
  const [state, setState] = useState(() => {
    const keys = MESSAGE_STEPS.flatMap((s) => [`msg_${s.key}`, `notify_${s.key}`, `tpl_${s.key}`]);
    return Object.fromEntries(keys.map((k) => [k, values[k] ?? ""]));
  });
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string) => setState((s) => ({ ...s, [key]: value }));
  const garage = values.center_name;

  function insert(step: MessageStep, name: string) {
    const key = `msg_${step.key}`;
    const box = document.getElementById(key) as HTMLTextAreaElement | null;
    const text = state[key];
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? text.length;
    const token = `{{${name}}}`;
    set(key, text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    setBusy(true);
    try {
      await api("/api/settings", { method: "PATCH", body: state });
      toast.success("Messages saved");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6 pb-20">
      {GROUPS.map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="font-semibold">{group}</h2>
          {MESSAGE_STEPS.filter((s) => s.group === group).map((step) => {
            const on = state[`notify_${step.key}`] !== "false";
            const msgKey = `msg_${step.key}`;
            return (
              <article key={step.key} className={cn("space-y-3 rounded-xl border bg-card p-4", !on && "opacity-60")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium">{step.label}</h3>
                    <p className="text-xs text-muted-foreground">When: {step.when}</p>
                  </div>
                  {!("alwaysOn" in step) && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={on} onChange={(e) => set(`notify_${step.key}`, String(e.target.checked))} />
                      Send this message
                    </label>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={msgKey}>Message</Label>
                  <Textarea id={msgKey} value={state[msgKey]} onChange={(e) => set(msgKey, e.target.value)} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Insert:</span>
                  {step.vars.map((name) => (
                    <button key={name} type="button" onClick={() => insert(step, name)} className="rounded-full border px-2 py-0.5 hover:bg-accent">{name.replaceAll("_", " ")}</button>
                  ))}
                  <button type="button" onClick={() => set(msgKey, step.text)} className="ml-auto text-primary hover:underline">Reset to default</button>
                </div>
                <div className="rounded-lg bg-green-50 p-3 text-sm whitespace-pre-wrap text-green-950">
                  <p className="mb-1 text-xs font-medium text-green-800">Customer sees</p>
                  {fill(state[msgKey], { ...SAMPLE, garage_name: garage }) || "Nothing. A blank message isn't sent."}
                </div>
              </article>
            );
          })}
        </section>
      ))}
      <div className="sticky bottom-3">
        <Button size="lg" className="w-full shadow-lg" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save all messages"}</Button>
      </div>
    </div>
  );
}
