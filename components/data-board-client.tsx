"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

export type DataCard = {
  id: string;
  /** Column keys this card can actually land in. Leave out when every column that takes drops will do. */
  dropTo?: string[];
  title: React.ReactNode;
  /** Top-right of the card, such as an edit button. */
  actions?: React.ReactNode;
  lines?: React.ReactNode[];
  left?: React.ReactNode;
  right?: React.ReactNode;
  footer?: React.ReactNode;
};

/** `drop` is what dropping a card here saves. Columns without one are worked out from the record, so they can't take drops. */
export type DataColumn = { key: string; label: string; color: string; cards: DataCard[]; drop?: Record<string, unknown> };

/** A drop must be able to put the card in that column, or "Moved to" would be untrue. */
export const canDrop = (card: Pick<DataCard, "dropTo">, from: string, column: Pick<DataColumn, "key" | "drop">) =>
  Boolean(column.drop) && from !== column.key && (!card.dropTo || card.dropTo.includes(column.key));

export function DataBoard({ columns, empty = "Nothing here", dropEndpoint }: {
  columns: DataColumn[];
  empty?: string;
  /** PATCH target for drops, with :id standing for the card. */
  dropEndpoint?: string;
}) {
  const router = useRouter();
  const [dragging, setDragging] = useState<{ id: string; from: string; dropTo?: string[] } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  async function drop(column: DataColumn) {
    const card = dragging;
    setDragging(null);
    setOver(null);
    if (!card || !dropEndpoint || !canDrop(card, card.from, column)) return;
    try {
      await api(dropEndpoint.replace(":id", card.id), { method: "PATCH", body: column.drop });
      toast.success(`Moved to ${column.label}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-4">
      {columns.map((column) => {
        const droppable = Boolean(dragging && canDrop(dragging, dragging.from, column));
        return (
          <section
            key={column.key}
            aria-label={column.label}
            onDragOver={(e) => {
              if (!droppable) return;
              e.preventDefault();
              setOver(column.key);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              void drop(column);
            }}
            className={cn("w-64 shrink-0 rounded-lg border bg-muted/40 p-2", droppable && "border-dashed border-primary", over === column.key && "bg-accent")}
          >
            <header className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", column.color)}>{column.label}</span>
              <span className="text-xs font-medium text-muted-foreground tabular-nums">{column.cards.length}</span>
            </header>
            <div className="min-h-16 space-y-2">
              {column.cards.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">{empty}</p>}
              {column.cards.map((card) => {
                const movable = Boolean(dropEndpoint) && card.dropTo?.length !== 0;
                return (
                <article
                  key={card.id}
                  draggable={movable}
                  onDragStart={(e) => {
                    if (!e.currentTarget.contains(e.target as Node)) return;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", card.id);
                    setDragging({ id: card.id, from: column.key, dropTo: card.dropTo });
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cn("space-y-1 rounded-lg border bg-card p-2.5 text-sm shadow-xs", movable && "cursor-grab active:cursor-grabbing")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 font-medium break-words">{card.title}</div>
                    {card.actions && <div className="flex shrink-0 items-center gap-1">{card.actions}</div>}
                  </div>
                  {card.lines?.map((line, i) => <div key={i} className="text-xs break-words text-muted-foreground">{line}</div>)}
                  {(card.left || card.right) && (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate">{card.left}</span>
                      <span className="shrink-0 tabular-nums">{card.right}</span>
                    </div>
                  )}
                  {card.footer}
                </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
