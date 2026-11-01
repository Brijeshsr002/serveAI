"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client";
import { liveRefreshPaused } from "@/lib/live-refresh";
import type { ComposerTemplates } from "@/lib/services/whatsapp-templates";

/** New inbound messages arrive by webhook; re-render the server component to pick them up. */
export function InboxAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!liveRefreshPaused(document)) router.refresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

export function ScrollToEnd({ dep }: { dep: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // Braces matter: newer browsers return a Promise here, which React would call as a cleanup.
  useEffect(() => {
    ref.current?.scrollIntoView();
  }, [dep]);
  return <div ref={ref} />;
}

type Approved = ComposerTemplates["approved"][number];

const unfilled = /\{\{\w+\}\}/;

export function Composer({ customerId, windowOpen, serviceJobId }: { customerId: string; windowOpen: boolean; serviceJobId?: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [templates, setTemplates] = useState<ComposerTemplates | null>(null);
  const [loadError, setLoadError] = useState("");
  const [chosen, setChosen] = useState<Approved | null>(null);
  const [values, setValues] = useState<string[]>([]);

  async function togglePicker() {
    const next = !picker;
    setPicker(next);
    setChosen(null);
    if (!next) return;
    setLoadError("");
    try {
      setTemplates(await api<ComposerTemplates>(`/api/whatsapp/templates?customerId=${encodeURIComponent(customerId)}`));
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }

  function choose(template: Approved) {
    setChosen(template);
    setValues(template.params.map((p) => p.value));
  }

  async function deliver(body: Record<string, unknown>, after: () => void) {
    setBusy(true);
    try {
      await api("/api/whatsapp/send", { method: "POST", body: { customerId, serviceJobId: templates?.serviceJobId ?? serviceJobId, ...body } });
      after();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || unfilled.test(text)) return;
    void deliver({ text }, () => setText(""));
  }

  function sendTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen || values.some((v) => !v.trim())) return;
    const preview = chosen.body.replace(/\{\{(\d+)\}\}/g, (_, n) => values[Number(n) - 1] ?? "");
    void deliver({ templateName: chosen.name, bodyParameters: values, text: preview }, () => {
      setChosen(null);
      setPicker(false);
      toast.success("Template sent");
    });
  }

  const blanks = unfilled.test(text);
  return (
    <div className="border-t">
      {picker && (
        <div className="max-h-72 space-y-3 overflow-y-auto border-b bg-muted/40 p-3 text-sm">
          {loadError && <p role="alert" className="text-destructive">{loadError}</p>}
          {!templates && !loadError && <p className="text-muted-foreground">Loading templates…</p>}
          {templates && !chosen && (
            <>
              {windowOpen && (
                <section>
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">Messages you can edit</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.messages.map((m) => (
                      <button key={m.key} type="button" onClick={() => { setText(m.text); setPicker(false); }} className="rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-accent">{m.label}</button>
                    ))}
                  </div>
                </section>
              )}
              <section>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">Approved WhatsApp templates</h3>
                {templates.approved.length === 0 && <p className="text-muted-foreground">No templates are set in Settings.</p>}
                <div className="flex flex-wrap gap-1.5">
                  {templates.approved.map((t) => (
                    <button key={t.name} type="button" onClick={() => choose(t)} className="rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-accent">{t.label}</button>
                  ))}
                </div>
              </section>
            </>
          )}
          {chosen && (
            <form onSubmit={sendTemplate} className="space-y-2">
              <p className="font-medium">{chosen.label}</p>
              <p className="rounded-lg bg-green-50 p-2 break-words text-green-950 [overflow-wrap:anywhere]">{chosen.body.replace(/\{\{(\d+)\}\}/g, (whole, n) => values[Number(n) - 1] || whole)}</p>
              {chosen.params.map((p, i) => (
                <label key={p.label} className="block text-xs font-medium">
                  {p.label}
                  <Input required value={values[i] ?? ""} onChange={(e) => setValues((v) => v.map((old, j) => (j === i ? e.target.value : old)))} placeholder={`Type the ${p.label.toLowerCase()}`} className="mt-0.5" />
                </label>
              ))}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || values.some((v) => !v.trim())}>{busy ? "Sending…" : "Send template"}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(null)}>Back</Button>
              </div>
            </form>
          )}
        </div>
      )}
      {windowOpen ? (
        <form onSubmit={send} className="flex items-end gap-2 p-3">
          <Button type="button" variant="outline" onClick={togglePicker} aria-expanded={picker}>Templates</Button>
          <div className="min-w-0 flex-1">
            <Textarea aria-label="Message" rows={1} className="min-h-9" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" />
            {blanks && <p className="mt-1 text-xs text-destructive">Replace the {"{{…}}"} parts before sending.</p>}
          </div>
          <Button type="submit" disabled={busy || !text.trim() || blanks}>Send</Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-muted-foreground">
          <p className="min-w-0 flex-1">This customer hasn&apos;t messaged in 24 hours, so WhatsApp only allows approved templates.</p>
          <Button type="button" onClick={togglePicker} aria-expanded={picker}>Templates</Button>
        </div>
      )}
    </div>
  );
}
