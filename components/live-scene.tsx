"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const FADE_MS = 900;

/** Real footage behind a dark wash. People who ask for reduced motion get a still photo instead. */
export function LiveScene({ clips, className, overlay, children }: { clips: string[]; className?: string; overlay?: string; children?: React.ReactNode }) {
  const [moving, setMoving] = useState(false);
  const [slots, setSlots] = useState([0, 1]);
  const [front, setFront] = useState(0);
  const [fading, setFading] = useState(false);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const back = 1 - front;
  const single = clips.length < 2;
  const src = (slot: number) => clips[slots[slot] % clips.length];

  useEffect(() => setMoving(!window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  useEffect(() => {
    if (moving) void videos.current[0]?.play().catch(() => {});
  }, [moving]);

  // The next clip is already loaded behind this one, so it can start before this one ends.
  function startFade() {
    if (fading || single) return;
    void videos.current[back]?.play().catch(() => {});
    setFading(true);
  }

  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(() => {
      videos.current[front]?.pause();
      setSlots((current) => current.map((clip, slot) => (slot === front ? current[back] + 1 : clip)));
      setFront(back);
      setFading(false);
    }, FADE_MS);
    return () => clearTimeout(timer);
  }, [fading, front, back]);

  return (
    <div className={cn("relative overflow-hidden bg-slate-950 text-white", className)} style={{ backgroundImage: `url(/media/${clips[0]}.jpg)`, backgroundSize: "cover", backgroundPosition: "center" }}>
      {moving && (single ? [0] : [0, 1]).map((slot) => (
        <video
          key={slot}
          ref={(el) => {
            videos.current[slot] = el;
          }}
          aria-hidden="true"
          className="absolute inset-0 size-full object-cover"
          style={{
            opacity: slot === front || fading ? 1 : 0,
            zIndex: slot === front ? 0 : 1,
            transition: fading && slot === back ? `opacity ${FADE_MS}ms ease-in-out` : "none",
          }}
          src={`/media/${src(slot)}.mp4`}
          poster={`/media/${src(slot)}.jpg`}
          preload="auto"
          muted
          playsInline
          loop={single}
          onTimeUpdate={(e) => {
            const { duration, currentTime } = e.currentTarget;
            if (slot === front && duration - currentTime < FADE_MS / 1000) startFade();
          }}
          onEnded={() => {
            if (slot === front) startFade();
          }}
        />
      ))}
      <div aria-hidden="true" className={cn("absolute inset-0 z-[2]", overlay ?? "bg-gradient-to-r from-[#0B1033]/92 via-[#0B1033]/70 to-[#0B1033]/30")} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
