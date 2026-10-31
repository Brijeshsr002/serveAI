"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client";

type Group = { title: string; hint?: string; fields: { key: string; label: string; long?: boolean; toggle?: boolean }[] };

export function SettingsForm({ groups, values }: { groups: Group[]; values: Record<string, string> }) {
  const router = useRouter();
  const [state, setState] = useState(values);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setState((s) => ({ ...s, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/settings", { method: "PATCH", body: state });
      toast.success("Settings saved");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-6">
      {groups.map((g) => (
        <fieldset key={g.title} className="space-y-3 rounded-xl border bg-card p-4">
          <legend className="px-1 font-medium">{g.title}</legend>
          {g.hint && <p className="text-sm text-muted-foreground">{g.hint}</p>}
          {g.fields.map((f) =>
            f.toggle ? (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={state[f.key] === "true"} onChange={(e) => set(f.key, String(e.target.checked))} />
                {f.label}
              </label>
            ) : (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={f.key}>{f.label}</Label>
                {f.long ? (
                  <Textarea id={f.key} value={state[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                ) : (
                  <Input id={f.key} value={state[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                )}
              </div>
            ),
          )}
        </fieldset>
      ))}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</Button>
    </form>
  );
}
