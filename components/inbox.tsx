"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client";

/** New inbound messages arrive by webhook; re-render the server component to pick them up. */
export function InboxAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 15_000);
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

export function Composer({ customerId, windowOpen }: { customerId: string; windowOpen: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api("/api/whatsapp/send", { method: "POST", body: { customerId, text } });
      setText("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  if (!windowOpen) {
    return (
      <p className="border-t p-3 text-sm text-muted-foreground">
        This customer hasn&apos;t messaged in 24 hours, so WhatsApp only allows approved templates. Automatic status updates still go out as templates.
      </p>
    );
  }
  return (
    <form onSubmit={send} className="flex gap-2 border-t p-3">
      <Textarea aria-label="Message" rows={1} className="min-h-9" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" />
      <Button type="submit" disabled={busy || !text.trim()}>Send</Button>
    </form>
  );
}
