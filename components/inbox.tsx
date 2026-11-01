"use client";

import { SendHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client";
import { liveRefreshPaused } from "@/lib/live-refresh";
import type { ComposerTemplates } from "@/lib/services/whatsapp-templates";

const LIVE_MS = 8_000;

/** Brings in what's new from Sendiee, then re-renders the server component to show it. */
export function InboxAutoRefresh({ customerId }: { customerId?: string }) {
  const router = useRouter();
  useEffect(() => {
    let running = false;
    async function tick() {
      if (running || document.hidden || liveRefreshPaused(document)) return;
      running = true;
      // A missed tick is harmless; the next one catches up.
      await api(`/api/whatsapp/sync${customerId ? `?c=${encodeURIComponent(customerId)}` : ""}`, { method: "POST" }).catch(() => {});
      running = false;
      router.refresh();
    }
    void tick();
    const timer = setInterval(() => void tick(), LIVE_MS);
    return () => clearInterval(timer);
  }, [router, customerId]);
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


const unfilled = /\{\{\w+\}\}/;

export function Composer({ customerId, serviceJobId }: { customerId: string; serviceJobId?: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [templates, setTemplates] = useState<ComposerTemplates | null>(null);
  const [loadError, setLoadError] = useState("");

  async function togglePicker() {
    const next = !picker;
    setPicker(next);
    if (!next) return;
    setLoadError("");
    try {
      setTemplates(await api<ComposerTemplates>(`/api/whatsapp/templates?customerId=${encodeURIComponent(customerId)}`));
    } catch (err) {
      setLoadError((err as Error).message);
    }
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

  function send(e: React.FormEvent | React.KeyboardEvent) {
    e.preventDefault();
    if (busy || !text.trim() || unfilled.test(text)) return;
    void deliver({ text }, () => setText(""));
  }

  const blanks = unfilled.test(text);
  return (
    <div className="bg-[#f0f2f5] dark:bg-[#202c33]">
      {picker && (
        <div className="max-h-56 space-y-3 overflow-y-auto border-b p-3 text-sm">
          {loadError && <p role="alert" className="text-destructive">{loadError}</p>}
          {!templates && !loadError && <p className="text-muted-foreground">Loading messages…</p>}
          {templates && (
            <div className="flex flex-wrap gap-1.5">
              {templates.messages.map((m) => (
                <button key={m.key} type="button" onClick={() => { setText(m.text); setPicker(false); }} className="rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-accent">{m.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <form onSubmit={send} className="flex items-end gap-2 px-3 py-2">
        <Button type="button" variant="ghost" onClick={togglePicker} aria-expanded={picker}>Messages</Button>
        <div className="min-w-0 flex-1">
          <Textarea aria-label="Message" rows={1} className="min-h-9 rounded-lg border-0 bg-white shadow-none dark:bg-[#2a3942]" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e); }} placeholder="Type a message" />
          {blanks && <p className="mt-1 text-xs text-destructive">Replace the {"{{…}}"} parts before sending.</p>}
        </div>
        <Button type="submit" aria-label="Send" className="bg-[#00a884] text-white hover:bg-[#029273]" disabled={busy || !text.trim() || blanks}><SendHorizontal className="size-4" /></Button>
      </form>
    </div>
  );
}
