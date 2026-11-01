import Link from "next/link";
import { cn } from "@/lib/utils";

export { DataBoard, type DataCard, type DataColumn } from "@/components/data-board-client";

/** Kanban is the default view on data pages; `?view=list` shows the table. */
export const isBoardView = (view?: string) => view !== "list";

export function ViewSwitch({ board, q }: { board: boolean; q?: string }) {
  const link = (list: boolean) => {
    const params = new URLSearchParams();
    if (list) params.set("view", "list");
    if (q) params.set("q", q);
    return `?${params}`;
  };
  const tab = (active: boolean) => cn("rounded-md px-3 py-1 hover:bg-accent", active && "bg-primary font-medium text-primary-foreground hover:bg-primary");
  return (
    <nav aria-label="View" className="flex rounded-lg border bg-card p-0.5 text-sm">
      <Link href={link(false)} aria-current={board ? "page" : undefined} className={tab(board)}>Kanban</Link>
      <Link href={link(true)} aria-current={board ? undefined : "page"} className={tab(!board)}>List</Link>
    </nav>
  );
}
