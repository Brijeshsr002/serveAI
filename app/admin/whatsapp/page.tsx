import Link from "next/link";
import { ActionButton } from "@/components/actions";
import { Composer, InboxAutoRefresh, ScrollToEnd } from "@/components/inbox";
import { Field, PageHeader, StatusBadge, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { isWindowOpen } from "@/lib/notifications";
import { roleBase, STAFF } from "@/lib/permissions";
import { isSendieeConfigured } from "@/lib/sendiee";
import { ACTIVE_STATUSES } from "@/lib/status";
import { cn } from "@/lib/utils";

export default async function WhatsappPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const { c } = await searchParams;
  const conversations = await db.whatsappConversation.findMany({
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 200,
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
  const selectedId = c ?? conversations[0]?.customerId;
  const selected = selectedId
    ? await db.customer.findUnique({
        where: { id: selectedId },
        include: {
          vehicles: true,
          messages: { orderBy: { createdAt: "asc" }, take: 300 },
          serviceJobs: { where: { status: { in: ACTIVE_STATUSES } }, orderBy: { createdAt: "desc" } },
        },
      })
    : null;
  if (selected) await db.whatsappConversation.updateMany({ where: { customerId: selected.id, unreadCount: { gt: 0 } }, data: { unreadCount: 0 } });
  const windowOpen = selected ? await isWindowOpen(selected.id) : false;

  return (
    <>
      <InboxAutoRefresh />
      <PageHeader title="WhatsApp" subtitle={isSendieeConfigured() ? "Connected to Sendiee" : "Sendiee is not configured: messages will fail until SENDIEE_API_KEY and SENDIEE_BRAND_NUMBER are set"} />
      <div className="grid h-[calc(100vh-11rem)] min-h-[28rem] grid-cols-1 overflow-hidden rounded-xl border bg-card md:grid-cols-[17rem_1fr] xl:grid-cols-[17rem_1fr_16rem]">
        <ul className={cn("overflow-y-auto border-r", selected && "hidden md:block")}>
          {conversations.length === 0 && <li className="p-4 text-sm text-muted-foreground">No conversations yet</li>}
          {conversations.map((conv) => (
            <li key={conv.id}>
              <Link href={`?c=${conv.customerId}`} className={cn("block border-b p-3 hover:bg-accent", conv.customerId === selectedId && "bg-accent")}>
                <div className="flex justify-between gap-2">
                  <span className="truncate text-sm font-medium">{conv.customer.name}</span>
                  {conv.unreadCount > 0 && conv.customerId !== selectedId && (
                    <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{conv.unreadCount}</span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{conv.lastMessage}</p>
                <p className="text-[11px] text-muted-foreground">{dateTime(conv.lastMessageAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
        {selected ? (
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex items-center justify-between gap-2 border-b p-3">
              <div>
                <Link href="?" className="mr-2 text-sm text-primary md:hidden">←</Link>
                <span className="font-medium">{selected.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">+{selected.phone}</span>
              </div>
              <ActionButton label="Sync from Sendiee" variant="outline" endpoint={`/api/whatsapp/conversations/${selected.id}/sync`} success="Conversation synced" />
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3">
              {selected.messages.length === 0 && <p className="text-center text-sm text-muted-foreground">No messages yet</p>}
              {selected.messages.map((m) => (
                <div key={m.id} className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm", m.direction === "OUTBOUND" ? "ml-auto bg-primary/10" : "bg-background")}>
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.content}</p>
                  <p className="mt-1 text-right text-[11px] text-muted-foreground">
                    {dateTime(m.createdAt)}{m.direction === "OUTBOUND" && ` · ${m.status.toLowerCase()}`}
                  </p>
                  {m.status === "FAILED" && m.error && <p className="text-[11px] text-destructive">{m.error}</p>}
                </div>
              ))}
              <ScrollToEnd dep={selected.messages.length} />
            </div>
            <Composer key={selected.id} customerId={selected.id} windowOpen={windowOpen} />
          </div>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Select a conversation</p>
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
