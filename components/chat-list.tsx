"use client";

import { MessageSquarePlus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

export type ChatRow = { customerId: string; name: string; initials: string; phone: string; lastMessage: string | null; when: string; unread: number };

export function ChatList({ chats, selectedId }: { chats: ChatRow[]; selectedId?: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const term = search.trim().toLowerCase();
  const digits = term.replace(/\D/g, "");
  const shown = chats.filter((c) => (!unreadOnly || c.unread > 0) && (!term || c.name.toLowerCase().includes(term) || (digits !== "" && c.phone.includes(digits))));

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { customerId } = await api<{ customerId: string }>("/api/whatsapp/conversations", { method: "POST", body: { phone, name: name || undefined } });
      setAdding(false);
      setPhone("");
      setName("");
      router.push(`?c=${customerId}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Chats</h1>
          <Button type="button" variant="ghost" size="icon" aria-label="New chat" aria-expanded={adding} onClick={() => setAdding(!adding)}><MessageSquarePlus className="size-5" /></Button>
        </div>
        {adding && (
          <form onSubmit={start} data-live-refresh-pause className="space-y-2 rounded-lg bg-[#f0f2f5] p-2 dark:bg-[#202c33]">
            <Input required aria-label="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Phone number" />
            <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" />
            <Button type="submit" size="sm" className="w-full bg-[#00a884] text-white hover:bg-[#029273]" disabled={busy}>{busy ? "Opening…" : "Start chat"}</Button>
          </form>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search chats" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" className="rounded-lg border-0 bg-[#f0f2f5] pl-9 dark:bg-[#202c33]" />
        </div>
        <div className="flex gap-1.5 text-sm">
          {[false, true].map((value) => (
            <button key={String(value)} type="button" aria-pressed={unreadOnly === value} onClick={() => setUnreadOnly(value)} className={cn("rounded-full px-3 py-1", unreadOnly === value ? "bg-[#d9fdd3] text-[#008069] dark:bg-[#005c4b] dark:text-white" : "bg-[#f0f2f5] text-muted-foreground dark:bg-[#202c33]")}>
              {value ? "Unread" : "All"}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">No chats</li>}
        {shown.map((chat) => (
          <li key={chat.customerId}>
            <Link href={`?c=${chat.customerId}`} className={cn("flex items-center gap-3 px-3 py-2.5 hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]", chat.customerId === selectedId && "bg-[#f0f2f5] dark:bg-[#2a3942]")}>
              <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-sm font-semibold text-[#54656f] dark:bg-[#374248] dark:text-[#e9edef]">{chat.initials}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{chat.name}</span>
                  <span className={cn("shrink-0 text-xs text-muted-foreground", chat.unread > 0 && "font-medium text-[#00a884]")}>{chat.when}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-muted-foreground">{chat.lastMessage ?? "No messages yet"}</span>
                  {chat.unread > 0 && chat.customerId !== selectedId && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#00a884] px-1 text-xs font-medium text-white">{chat.unread}</span>}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
