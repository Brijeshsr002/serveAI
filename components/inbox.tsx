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

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || unfilled.test(text)) return;
    void deliver({ text }, () => setText(""));
  }

  const blanks = unfilled.test(text);
  return (
    <div className="border-t">
      {picker && (
        <div className="max-h-72 space-y-3 overflow-y-auto border-b bg-muted/40 p-3 text-sm">
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
      <form onSubmit={send} className="flex items-end gap-2 p-3">
        <Button type="button" variant="outline" onClick={togglePicker} aria-expanded={picker}>Messages</Button>
        <div className="min-w-0 flex-1">
          <Textarea aria-label="Message" rows={1} className="min-h-9" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" />
          {blanks && <p className="mt-1 text-xs text-destructive">Replace the {"{{…}}"} parts before sending.</p>}
        </div>
        <Button type="submit" disabled={busy || !text.trim() || blanks}>Send</Button>
      </form>
    </div>
  );
}
