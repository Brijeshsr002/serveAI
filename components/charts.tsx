"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CarGlyph } from "@/components/car-art";

const LANE_COLORS = ["#EA580C", "#0F766E", "#1D4ED8", "#BE123C", "#7C3AED", "#CA8A04"];
const REVENUE = "#EA580C";
const INK = "#64748b";
const GRID = "#eceef2";

type Row = Record<string, string | number>;

const inr = (v: number) => `₹${new Intl.NumberFormat("en-IN").format(v)}`;

function DataTable({ rows, keys, currency }: { rows: Row[]; keys: { key: string; label: string }[]; currency?: boolean }) {
  return (
    <details className="mt-2 text-xs text-muted-foreground">
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

/** A race lane: the car has driven further the higher the value. */
function Lane({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const distance = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2" title={`${label}: ${value}`}>
      <div className="relative h-7 min-w-0 flex-1 rounded-md bg-slate-800">
        <div className="road-dashes absolute inset-x-1 top-1/2 h-px -translate-y-1/2 opacity-40" />
        <div className="absolute inset-y-0 left-0 rounded-md opacity-90" style={{ width: `calc((100% - 44px) * ${distance / 100} + 22px)`, backgroundColor: color }} />
        <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `calc((100% - 44px) * ${distance / 100})` }}>
          <CarGlyph color="#fff" className="h-[18px] w-11 drop-shadow" />
        </div>
      </div>
      <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function RevenueChart({ data, label }: { data: Row[]; label: string }) {
  const id = `revenue-${label}-${data.length}`.replace(/\W/g, "");
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ right: 28, top: 22 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={REVENUE} stopOpacity={0.45} />
            <stop offset="100%" stopColor={REVENUE} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} />
        <YAxis width={60} allowDecimals={false} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} tickFormatter={inr} />
        <Tooltip formatter={(v) => [inr(Number(v)), label]} cursor={{ stroke: REVENUE, strokeDasharray: "4 4" }} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={REVENUE}
          strokeWidth={3}
          fill={`url(#${id})`}
          isAnimationActive={false}
          // The car rides the line and parks on the latest figure.
          dot={(props: { cx?: number; cy?: number; index?: number }) =>
            props.index === data.length - 1 && props.cx !== undefined && props.cy !== undefined ? (
              <svg key={props.index} x={props.cx - 26} y={props.cy - 22} width={52} height={20} viewBox="0 0 120 46"><CarGlyph color="#0F172A" /></svg>
            ) : (
              <g key={props.index} />
            )
          }
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** One series, so the card title names it and no legend is needed. */
export function SingleBarChart({ data, label, currency, horizontal }: { data: Row[]; label: string; currency?: boolean; horizontal?: boolean }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No data yet</p>;
  const max = Math.max(...data.map((r) => Number(r.value)));
  return (
    <>
      {horizontal ? (
        <ul className="space-y-2">
          {data.map((r, i) => (
            <li key={String(r.name)} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-xs">
              <span className="truncate font-medium" title={String(r.name)}>{r.name}</span>
              <Lane value={Number(r.value)} max={max} color={LANE_COLORS[i % LANE_COLORS.length]} label={label} />
            </li>
          ))}
        </ul>
      ) : (
        <RevenueChart data={data} label={label} />
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
      <div className="mb-3 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ backgroundColor: LANE_COLORS[0] }} /> Completed</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ backgroundColor: LANE_COLORS[1] }} /> Active</span>
      </div>
      <ul className="space-y-3">
        {data.map((r) => (
          <li key={String(r.name)} className="space-y-1">
            <p className="truncate text-xs font-medium">{r.name}</p>
            <Lane value={Number(r.completed)} max={max} color={LANE_COLORS[0]} label="Completed" />
            <Lane value={Number(r.active)} max={max} color={LANE_COLORS[1]} label="Active" />
          </li>
        ))}
      </ul>
      <DataTable rows={data} keys={[{ key: "completed", label: "Completed" }, { key: "active", label: "Active" }]} />
    </>
  );
}
