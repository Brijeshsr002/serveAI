"use client";

import { memo, useCallback, useId } from "react";
import { Bar, BarChart, type BarShapeProps, CartesianGrid, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDrill } from "@/components/drilldown";
import { cn } from "@/lib/utils";

const COLORS = ["#8B7CF6", "#4FD1C5", "#7DB5F5", "#F58FBF", "#F7C96B", "#B39DF8", "#67D4E8", "#B5DE6B", "#A7B4C6"];
const INK = "#64748b";
const GRID = "#eef1f5";
const CLICKABLE = "w-full cursor-pointer rounded-md text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring";

type Row = Record<string, string | number>;
type Pick = (row: Row) => void;

const inr = (v: number) => `₹${new Intl.NumberFormat("en-IN").format(v)}`;
const shortInr = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`);

function DataTable({ rows, keys, currency, onPick }: { rows: Row[]; keys: { key: string; label: string }[]; currency?: boolean; onPick?: Pick }) {
  return (
    <details className="mt-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer">View as table</summary>
      <table className="mt-1 w-full">
        <thead><tr><th className="text-left font-medium">Name</th>{keys.map((k) => <th key={k.key} className="text-right font-medium">{k.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.name)}>
              <td>{onPick ? <button type="button" className={cn(CLICKABLE, "underline-offset-2 hover:underline")} onClick={() => onPick(r)}>{r.name}</button> : r.name}</td>
              {keys.map((k) => <td key={k.key} className="text-right tabular-nums">{currency ? inr(Number(r[k.key])) : r[k.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Meter({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <span className="block h-2.5 overflow-hidden rounded-full bg-slate-100">
      <span className="block h-full rounded-full" style={{ width: `${max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0}%`, backgroundColor: color }} />
    </span>
  );
}

/**
 * Any re-render makes Recharts rebuild its bars, which would take keyboard focus off them. So this skips the
 * re-render when a dialog opens, and on live refreshes that bring the same figures.
 */
const RevenueBars = memo(RevenueBarsChart, (a, b) => a.label === b.label && a.onPick === b.onPick && JSON.stringify(a.data) === JSON.stringify(b.data));

function RevenueBarsChart({ data, label, onPick }: { data: Row[]; label: string; onPick?: Pick }) {
  const id = useId().replace(/\W/g, "");
  const total = data.reduce((sum, r) => sum + Number(r.value), 0);
  return (
    <>
      <p className="text-2xl font-bold tabular-nums">{inr(total)}</p>
      <p className="mb-3 text-xs text-muted-foreground">Total for this period</p>
      <ResponsiveContainer width="100%" height={210}>
        {/* Each bar is its own focusable button below, so the chart-wide keyboard layer would only add a second tab stop. */}
        <BarChart data={data} margin={{ right: 4, top: 8, left: 0 }} accessibilityLayer={!onPick}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#B39DF8" />
              <stop offset="100%" stopColor="#8B7CF6" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: INK }} axisLine={false} tickLine={false} interval={0} angle={data.length > 6 ? -40 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 44 : 24} />
          <YAxis width={44} allowDecimals={false} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} tickFormatter={shortInr} />
          <Tooltip labelFormatter={(name, payload) => String(payload?.[0]?.payload?.full ?? name)} formatter={(v) => [inr(Number(v)), label]} cursor={{ fill: "rgba(139,124,246,0.08)" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }} />
          <Bar
            dataKey="value"
            fill={`url(#${id})`}
            radius={[6, 6, 0, 0]}
            maxBarSize={36}
            shape={(props: BarShapeProps) => {
              if (!onPick) return <Rectangle {...props} radius={[6, 6, 0, 0]} />;
              const row = props.payload as Row;
              return (
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${row.full ?? row.name}: ${inr(Number(row.value))}. Show the payments`}
                  className="group cursor-pointer outline-none"
                  onClick={() => onPick(row)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onPick(row);
                  }}
                >
                  {/* The whole column is the target, so small and zero bars can still be clicked. */}
                  <rect x={props.x} y={props.background?.y ?? props.y} width={props.width} height={props.background?.height ?? props.height} className="fill-transparent group-focus-visible:fill-primary/15" />
                  <Rectangle {...props} radius={[6, 6, 0, 0]} />
                </g>
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

/** One series, so the card title names it and no legend is needed. `drill` makes each bar open the records behind it. */
export function SingleBarChart({ data, label, currency, horizontal, drill }: { data: Row[]; label: string; currency?: boolean; horizontal?: boolean; drill?: "status" | "type" | "day" | "month" }) {
  const { open, dialog } = useDrill();
  const pick = useCallback<Pick>((r) => open({ kind: drill!, value: String(r.key), label: String(r.full ?? r.name) }), [open, drill]);
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No data yet</p>;
  const max = Math.max(...data.map((r) => Number(r.value)));
  const onPick = drill ? pick : undefined;
  return (
    <>
      {horizontal ? (
        <ul className="space-y-2">
          {data.map((r, i) => {
            const content = (
              <>
                <span className="mb-1 flex justify-between gap-3">
                  <span className="min-w-0 truncate" title={String(r.name)}>{r.name}</span>
                  <span className="font-semibold tabular-nums">{r.value}</span>
                </span>
                <Meter value={Number(r.value)} max={max} color={COLORS[i % COLORS.length]} />
              </>
            );
            return (
              <li key={String(r.name)} className="text-sm">
                {onPick
                  ? <button type="button" className={cn(CLICKABLE, "block p-1")} aria-label={`${r.name}: ${r.value}. Show the jobs`} onClick={() => onPick(r)}>{content}</button>
                  : <div className="p-1">{content}</div>}
              </li>
            );
          })}
        </ul>
      ) : (
        <RevenueBars data={data} label={label} onPick={onPick} />
      )}
      <DataTable rows={data} keys={[{ key: "value", label }]} currency={currency} onPick={onPick} />
      {drill && dialog}
    </>
  );
}

export function WorkerChart({ data, drill }: { data: Row[]; drill?: boolean }) {
  const drilldown = useDrill();
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No workers yet</p>;
  const max = Math.max(...data.flatMap((r) => [Number(r.completed), Number(r.active)]));
  const open = (r: Row, bucket?: "completed" | "active") => drilldown.open({ kind: "worker", value: String(r.key), bucket, label: String(r.name) });
  const line = (r: Row, bucket: "completed" | "active", name: string, color: string) => {
    const content = (
      <>
        <span className="text-muted-foreground">{name}</span>
        <Meter value={Number(r[bucket])} max={max} color={color} />
        <span className="text-right font-semibold tabular-nums">{r[bucket]}</span>
      </>
    );
    const grid = "grid grid-cols-[5rem_1fr_1.5rem] items-center gap-2 px-1 py-0.5 text-xs";
    return drill
      ? <button type="button" className={cn(CLICKABLE, grid)} aria-label={`${r.name}, ${name}: ${r[bucket]}. Show the jobs`} onClick={() => open(r, bucket)}>{content}</button>
      : <div className={grid}>{content}</div>;
  };
  return (
    <>
      <ul className="space-y-4">
        {data.map((r) => (
          <li key={String(r.key ?? r.name)} className="text-sm">
            <p className="mb-1 truncate font-medium">
              {drill ? <button type="button" className={cn(CLICKABLE, "truncate px-1")} aria-label={`Show all of ${r.name}'s jobs`} onClick={() => open(r)}>{r.name}</button> : r.name}
            </p>
            {line(r, "completed", "Completed", COLORS[0])}
            {line(r, "active", "Active", COLORS[1])}
          </li>
        ))}
      </ul>
      <DataTable rows={data} keys={[{ key: "completed", label: "Completed" }, { key: "active", label: "Active" }]} onPick={drill ? (r) => open(r) : undefined} />
      {drill && drilldown.dialog}
    </>
  );
}
