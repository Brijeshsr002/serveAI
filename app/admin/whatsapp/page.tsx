import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock } from "lucide-react";
import Link from "next/link";
import { ChatList, type ChatRow } from "@/components/chat-list";
import { Composer, InboxAutoRefresh, ScrollToEnd } from "@/components/inbox";
import { buttonVariants } from "@/components/ui/button";
import { Field, StatusBadge, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { addDays, date, istDayKey, time } from "@/lib/format";
import { roleBase, STAFF } from "@/lib/permissions";
import { isSendieeConfigured } from "@/lib/sendiee";
import { ACTIVE_STATUSES } from "@/lib/status";
import { cn } from "@/lib/utils";

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function dayLabel(d: Date) {
  const key = istDayKey(d);
  const now = new Date();
  if (key === istDayKey(now)) return "Today";
  if (key === istDayKey(addDays(now, -1))) return "Yesterday";
  return date(d);
}

/** The list shows the time for today, and the day for anything older, as WhatsApp does. */
const listWhen = (d: Date | null) => {
  if (!d) return "";
  const label = dayLabel(d);
  return label === "Today" ? time(d) : label;
};

function Ticks({ status }: { status: string }) {
  if (status === "FAILED") return <AlertCircle aria-label="Not sent" className="size-3.5 text-destructive" />;
  if (status === "QUEUED") return <Clock aria-label="Sending" className="size-3" />;
  if (status === "READ") return <CheckCheck aria-label="Read" className="size-4 text-[#53bdeb]" />;
  if (status === "DELIVERED") return <CheckCheck aria-label="Delivered" className="size-4" />;
  return <Check aria-label="Sent" className="size-4" />;
}

export default async function WhatsappPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const { c: selectedId } = await searchParams;
  const conversations = await db.whatsappConversation.findMany({
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 200,
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
  const selected = selectedId
    ? await db.customer.findUnique({
        where: { id: selectedId },
        include: {
          vehicles: true,
          messages: { orderBy: { createdAt: "desc" }, take: 300 },
          serviceJobs: { where: { status: { in: ACTIVE_STATUSES } }, orderBy: { createdAt: "desc" } },
        },
      })
    : null;
  if (selected) await db.whatsappConversation.updateMany({ where: { customerId: selected.id, unreadCount: { gt: 0 } }, data: { unreadCount: 0 } });
  const messages = selected ? [...selected.messages].reverse() : [];

  const chats: ChatRow[] = conversations.map((conv) => ({
    customerId: conv.customerId,
    name: conv.customer.name,
    initials: initials(conv.customer.name),
    phone: conv.customer.phone,
    lastMessage: conv.lastMessage,
    when: listWhen(conv.lastMessageAt),
    unread: conv.unreadCount,
  }));
  const brand = process.env.SENDIEE_BRAND_NUMBER;

  return (
    <>
      <InboxAutoRefresh customerId={selected?.id} />
      {!isSendieeConfigured() && <p role="alert" className="mb-2 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">WhatsApp isn&apos;t connected yet, so messages will fail until the Sendiee key and number are set.</p>}
      <div className="grid h-[calc(100dvh-6rem)] min-h-[28rem] grid-cols-1 overflow-hidden rounded-xl border bg-card md:grid-cols-[22rem_1fr] lg:h-[calc(100dvh-3rem)] xl:grid-cols-[22rem_1fr_16rem]">
        <div className={cn("flex min-h-0 min-w-0 flex-col border-r", selected && "hidden md:flex")}>
          <ChatList chats={chats} selectedId={selected?.id} />
          <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
            <span className="truncate">{brand ? `Sending from +${brand}` : "No number connected"}</span>
            {user.role === "ADMIN" && <Link href="/admin/messages" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0")}>Customer Messages</Link>}
          </div>
        </div>
        {selected ? (
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex items-center gap-3 bg-[#f0f2f5] px-3 py-2 dark:bg-[#202c33]">
              <Link href="?" aria-label="Back to chats" className="md:hidden"><ArrowLeft className="size-5" /></Link>
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-sm font-semibold text-[#54656f] dark:bg-[#374248] dark:text-[#e9edef]">{initials(selected.name)}</span>
              <div className="min-w-0">
                <p className="truncate font-medium">{selected.name}</p>
                <p className="truncate text-xs text-muted-foreground">+{selected.phone}</p>
              </div>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto bg-[#efeae2] p-3 md:px-10 dark:bg-[#0b141a]">
              {messages.length === 0 && <p className="mx-auto w-fit rounded-lg bg-[#fff5c4] px-3 py-1.5 text-center text-xs text-[#54656f]">No messages yet. Type below to send one.</p>}
              {messages.map((m, i) => {
                const outbound = m.direction === "OUTBOUND";
                const newDay = i === 0 || istDayKey(messages[i - 1].createdAt) !== istDayKey(m.createdAt);
                return (
                  <div key={m.id}>
                    {newDay && <p className="mx-auto my-2 w-fit rounded-lg bg-white px-3 py-1 text-xs text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">{dayLabel(m.createdAt)}</p>}
                    <div className={cn("w-fit max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm text-[#111b21] shadow-sm md:max-w-[65%] dark:text-[#e9edef]", outbound ? "ml-auto bg-[#d9fdd3] dark:bg-[#005c4b]" : "bg-white dark:bg-[#202c33]")}>
                      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.content}</p>
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[#667781] dark:text-[#ffffff99]">
                        {time(m.createdAt)}
                        {outbound && <Ticks status={m.status} />}
                      </p>
                      {m.status === "FAILED" && <p className="text-[11px] text-destructive [overflow-wrap:anywhere]">Not sent{m.error ? `: ${m.error}` : ""}</p>}
                    </div>
                  </div>
                );
              })}
              <ScrollToEnd dep={messages.length} />
            </div>
            <Composer key={selected.id} customerId={selected.id} />
          </div>
        ) : (
          <div className="hidden flex-col items-center justify-center gap-1 bg-[#f0f2f5] p-6 text-center md:flex dark:bg-[#202c33]">
            <p className="text-lg font-medium">Select a chat</p>
            <p className="text-sm text-muted-foreground">Messages go out from your connected WhatsApp number.</p>
          </div>
        )}
        {selected && (
          <aside className="hidden space-y-4 overflow-y-auto border-l p-4 xl:block">
            <dl className="space-y-3">
              <Field label="Customer"><TextLink href={`${base}/customers/${selected.id}`}>{selected.name}</TextLink></Field>
              <Field label="Code">{selected.customerCode}</Field>
              <Field label="Email">{selected.email}</Field>
              <Field label="City">{selected.city}</Field>
              <Field label="Vehicles">{selected.vehicles.map((v) => v.registrationNumber).join(", ")}</Field>
            </dl>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Active services</p>
              {selected.serviceJobs.length === 0 && <p className="text-sm">None</p>}
              <ul className="space-y-1.5">
                {selected.serviceJobs.map((j) => (
                  <li key={j.id} className="text-sm"><TextLink href={`${base}/jobs/${j.id}`}>{j.serviceNumber}</TextLink> <StatusBadge status={j.status} /></li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
