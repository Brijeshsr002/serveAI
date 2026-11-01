"use client";

import { useId } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = ["#4A2BE8", "#0E9F8E", "#2563EB", "#DB2777", "#D97706", "#7C3AED", "#0891B2", "#65A30D", "#475569"];
const INK = "#64748b";
const GRID = "#eef1f5";

type Row = Record<string, string | number>;

const inr = (v: number) => `₹${new Intl.NumberFormat("en-IN").format(v)}`;
const shortInr = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`);

function DataTable({ rows, keys, currency }: { rows: Row[]; keys: { key: string; label: string }[]; currency?: boolean }) {
  return (
    <details className="mt-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer">View as table</summary>
      <table className="mt-1 w-full">
        <thead><tr><th className="text-left font-medium">Name</th>{keys.map((k) => <th key={k.key} className="text-right font-medium">{k.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.name)}>
              <td>{r.name}</td>
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
    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full" style={{ width: `${max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0}%`, backgroundColor: color }} />
    </div>
  );
}

function RevenueBars({ data, label }: { data: Row[]; label: string }) {
  const id = useId().replace(/\W/g, "");
  const total = data.reduce((sum, r) => sum + Number(r.value), 0);
  return (
    <>
      <p className="text-2xl font-bold tabular-nums">{inr(total)}</p>
      <p className="mb-3 text-xs text-muted-foreground">Total for this period</p>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} margin={{ right: 4, top: 8, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7A5CFA" />
              <stop offset="100%" stopColor="#4A2BE8" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: INK }} axisLine={false} tickLine={false} interval={0} angle={data.length > 6 ? -40 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 44 : 24} />
          <YAxis width={44} allowDecimals={false} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} tickFormatter={shortInr} />
          <Tooltip labelFormatter={(name, payload) => String(payload?.[0]?.payload?.full ?? name)} formatter={(v) => [inr(Number(v)), label]} cursor={{ fill: "rgba(74,43,232,0.07)" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }} />
          <Bar dataKey="value" fill={`url(#${id})`} radius={[6, 6, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

/** One series, so the card title names it and no legend is needed. */
export function SingleBarChart({ data, label, currency, horizontal }: { data: Row[]; label: string; currency?: boolean; horizontal?: boolean }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No data yet</p>;
  const max = Math.max(...data.map((r) => Number(r.value)));
  return (
    <>
      {horizontal ? (
        <ul className="space-y-3">
          {data.map((r, i) => (
            <li key={String(r.name)} className="text-sm">
              <div className="mb-1 flex justify-between gap-3">
                <span className="min-w-0 truncate" title={String(r.name)}>{r.name}</span>
                <span className="font-semibold tabular-nums">{r.value}</span>
              </div>
              <Meter value={Number(r.value)} max={max} color={COLORS[i % COLORS.length]} />
            </li>
          ))}
        </ul>
      ) : (
        <RevenueBars data={data} label={label} />
      )}
      <DataTable rows={data} keys={[{ key: "value", label }]} currency={currency} />
    </>
  );
}

export function WorkerChart({ data }: { data: Row[] }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No workers yet</p>;
  const max = Math.max(...data.flatMap((r) => [Number(r.completed), Number(r.active)]));
  return (
    <>
      <ul className="space-y-4">
        {data.map((r) => (
          <li key={String(r.name)} className="text-sm">
            <p className="mb-1.5 truncate font-medium">{r.name}</p>
            <div className="grid grid-cols-[5rem_1fr_1.5rem] items-center gap-2 text-xs">
              <span className="text-muted-foreground">Completed</span>
              <Meter value={Number(r.completed)} max={max} color={COLORS[0]} />
              <span className="text-right font-semibold tabular-nums">{r.completed}</span>
              <span className="text-muted-foreground">Active</span>
              <Meter value={Number(r.active)} max={max} color={COLORS[1]} />
              <span className="text-right font-semibold tabular-nums">{r.active}</span>
            </div>
          </li>
        ))}
      </ul>
      <DataTable rows={data} keys={[{ key: "completed", label: "Completed" }, { key: "active", label: "Active" }]} />
    </>
  );
}
