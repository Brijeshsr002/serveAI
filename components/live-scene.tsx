"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Real footage behind a dark wash. People who ask for reduced motion get a still photo instead. */
export function LiveScene({ clips, className, overlay, children }: { clips: string[]; className?: string; overlay?: string; children?: React.ReactNode }) {
  const [index, setIndex] = useState(0);
  const [moving, setMoving] = useState(false);
  const clip = clips[index % clips.length];

  useEffect(() => setMoving(!window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  return (
    <div className={cn("relative overflow-hidden bg-slate-950 text-white", className)} style={{ backgroundImage: `url(/media/${clips[0]}.jpg)`, backgroundSize: "cover", backgroundPosition: "center" }}>
      {moving && (
        <video
          key={clip}
          aria-hidden="true"
          className="absolute inset-0 size-full object-cover"
          src={`/media/${clip}.mp4`}
          poster={`/media/${clip}.jpg`}
          autoPlay
          muted
          playsInline
          onEnded={() => setIndex((i) => i + 1)}
        />
      )}
      <div aria-hidden="true" className={cn("absolute inset-0", overlay ?? "bg-gradient-to-r from-slate-950/90 via-slate-950/65 to-slate-950/25")} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
