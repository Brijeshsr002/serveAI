"use client";

import type { ServiceStatus } from "@prisma/client";
import { Mic } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import { matchVoiceStatus, STATUS_LABEL } from "@/lib/status";

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (e: { results: { [i: number]: { [j: number]: { transcript: string }; length: number } } }) => void;
  onerror: (e: { error: string }) => void;
  onend: () => void;
  start: () => void;
};

const recognizer = () => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Speak a step ("start service", "waiting for parts"). Asks before changing, because the customer gets a message. */
export function VoiceStatus({ jobId, options }: { jobId: string; options: ServiceStatus[] }) {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [match, setMatch] = useState<ServiceStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSupported(Boolean(recognizer())), []);
  if (!supported || options.length === 0) return null;

  function listen() {
    const Speech = recognizer();
    if (!Speech) return;
    const speech = new Speech();
    speech.lang = "en-IN";
    speech.interimResults = false;
    speech.maxAlternatives = 3;
    speech.onresult = (e) => {
      const alternatives = e.results[0];
      const said = Array.from({ length: alternatives.length }, (_, i) => alternatives[i].transcript);
      setHeard(said[0] ?? "");
      setMatch(said.map((s) => matchVoiceStatus(s, options)).find(Boolean) ?? null);
    };
    speech.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast.error("Allow microphone access to use voice");
      else if (e.error !== "no-speech" && e.error !== "aborted") toast.error("Couldn't hear that. Please try again.");
    };
    speech.onend = () => setListening(false);
    setHeard("");
    setMatch(null);
    setListening(true);
    speech.start();
  }

  async function confirm(status: ServiceStatus) {
    setBusy(true);
    try {
      await api(`/api/service-jobs/${jobId}/status`, { method: "POST", body: { status } });
      toast.success(`Moved to ${STATUS_LABEL[status]}`);
      setHeard("");
      setMatch(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <Button type="button" variant="outline" size="lg" className="w-full" disabled={listening || busy} onClick={listen}>
        <Mic className="mr-2 size-4" /> {listening ? "Listening…" : "Speak the next step"}
      </Button>
      <p className="text-xs text-muted-foreground">Say: {options.map((s) => STATUS_LABEL[s]).join(", ")}</p>
      <div aria-live="polite">
        {heard && match && (
          <div className="space-y-2 text-sm">
            <p>Heard “{heard}”. Move to <strong>{STATUS_LABEL[match]}</strong>? The customer will be told.</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => confirm(match)}>Yes, move</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setHeard(""); setMatch(null); }}>No</Button>
            </div>
          </div>
        )}
        {heard && !match && <p className="text-sm text-destructive">Heard “{heard}”, which isn&apos;t one of the next steps. Please try again.</p>}
      </div>
    </div>
  );
}
