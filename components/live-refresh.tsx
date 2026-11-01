"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { liveRefreshPaused } from "@/lib/live-refresh";
import { cn } from "@/lib/utils";

const INTERVAL_MS = 20_000;

/**
 * Keeps every screen in step: a change made by the worker, reception, admin or a customer shows up
 * on the others within 20 seconds. Pauses in hidden tabs, and while someone is in the middle of a dialog or
 * a confirmation, because new data can move or remove the card that holds it.
 */
function useLiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !liveRefreshPaused(document)) router.refresh();
    };
    const timer = setInterval(refresh, INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
}

/** The refresh alone, for the staff pages. */
export function AutoRefresh() {
  useLiveRefresh();
  return null;
}

/** The refresh with its Live label, for the customer tracking page. */
export function LiveRefresh({ className }: { className?: string }) {
  useLiveRefresh();
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 text-xs font-medium text-green-700", className)} title="This page updates by itself">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-75 motion-reduce:hidden" />
        <span className="relative inline-flex size-2 rounded-full bg-green-600" />
      </span>
      Live
    </span>
  );
}
