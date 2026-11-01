import Link from "next/link";
import { cn } from "@/lib/utils";

export { DataBoard, type DataCard, type DataColumn } from "@/components/data-board-client";

/** Kanban is the default view on data pages; `?view=list` shows the table. */
export const isBoardView = (view?: unknown) => view !== "list";

/** The tab a query value asks for, or the first tab for anything else: junk, or a repeated parameter. */
export const pickTab = <T extends string>(value: unknown, tabs: readonly T[]): T => (tabs.includes(value as T) ? (value as T) : tabs[0]);

/** `keep` holds other query values that must survive switching view, such as the open tab. */
export function ViewSwitch({ board, q, keep }: { board: boolean; q?: string; keep?: Record<string, string> }) {
  const link = (list: boolean) => {
    const params = new URLSearchParams(keep);
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

/** Tabs across the top of a page, kept in the URL. `note` flags something waiting on a tab that isn't open. */
export function PageTabs({ label, param, tabs, active, keep }: {
  label: string;
  param: string;
  tabs: { key: string; label: string; note?: string }[];
  active: string;
  keep?: Record<string, string>;
}) {
  return (
    <nav aria-label={label} className="mb-4 flex gap-1 border-b text-sm">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`?${new URLSearchParams({ ...keep, [param]: t.key })}`}
          aria-current={t.key === active ? "page" : undefined}
          className={cn("-mb-px border-b-2 border-transparent px-3 py-2 whitespace-nowrap text-muted-foreground hover:text-foreground", t.key === active && "border-primary font-medium text-foreground")}
        >
          {t.label}
          {t.note && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">{t.note}</span>}
        </Link>
      ))}
    </nav>
  );
}
