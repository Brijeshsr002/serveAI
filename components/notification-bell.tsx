"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Feed = {
  unread: number;
  items: { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }[];
};

const INTERVAL_MS = 30_000;

/** Unread items stay highlighted while the list is open; the server already counts them as read. */
export function NotificationBell() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);
  openRef.current = open;

  useEffect(() => {
    // While the list is open the count is left alone, so the highlights aren't swapped out from under the reader.
    const load = () => {
      if (document.visibilityState !== "visible" || openRef.current) return;
      api<Feed>("/api/notifications").then((data) => { setFeed(data); setFailed(false); }, () => setFailed(true));
    };
    load();
    const timer = setInterval(load, INTERVAL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || !feed) {
      // Closing drops the highlights: everything shown has been seen.
      if (feed) setFeed({ ...feed, items: feed.items.map((i) => ({ ...i, readAt: i.readAt ?? i.createdAt })) });
      return;
    }
    if (feed.unread === 0) return;
    // Everything, not just the rows listed, or unread ones older than the list would keep the badge lit forever.
    setFeed({ ...feed, unread: 0 });
    api("/api/notifications/read", { method: "POST", body: {} }).catch(() => setFailed(true));
  }

  const unread = feed?.unread ?? 0;
  return (
    <div ref={root} className="relative shrink-0">
      <Button
        ref={button}
        variant="ghost"
        size="icon-sm"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        title="Notifications"
        onClick={toggle}
        className="relative"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span aria-hidden className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-96 w-80 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border bg-popover p-2 text-sm text-popover-foreground shadow-lg">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Notifications</p>
          {failed && <p role="alert" className="px-2 py-1 text-xs text-destructive">Couldn&apos;t refresh notifications.</p>}
          {feed && feed.items.length === 0 && <p className="p-2 text-muted-foreground">Nothing yet</p>}
          <ul>
            {feed?.items.map((item) => {
              const content = (
                <>
                  <span className="block font-medium">{item.title}</span>
                  <span className="block text-xs text-muted-foreground">{item.body}</span>
                  <span className="block text-[0.7rem] text-muted-foreground">{dateTime(item.createdAt)}</span>
                </>
              );
              const style = cn("block rounded px-2 py-1.5", !item.readAt && "bg-accent");
              return (
                <li key={item.id}>
                  {item.link ? <Link href={item.link} onClick={() => setOpen(false)} className={cn(style, "hover:bg-accent")}>{content}</Link> : <div className={style}>{content}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
