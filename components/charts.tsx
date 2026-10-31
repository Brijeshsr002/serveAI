"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Validated with the dataviz palette checker against the light surface (CVD and contrast pass).
const COLORS = ["#4A2BE8", "#0E9F8E"];
const INK = "#6b7280";
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

/** One series, so the card title names it and no legend is needed. */
export function SingleBarChart({ data, label, currency, horizontal }: { data: Row[]; label: string; currency?: boolean; horizontal?: boolean }) {
  const format = (v: number) => (currency ? inr(v) : String(v));
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No data yet</p>;
  return (
    <>
      <ResponsiveContainer width="100%" height={horizontal ? Math.max(220, data.length * 32) : 240}>
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: horizontal ? 16 : 0, right: 12, top: 8 }}>
          <CartesianGrid stroke={GRID} vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={124} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} />
              <YAxis width={currency ? 60 : 28} allowDecimals={false} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} tickFormatter={format} />
            </>
          )}
          <Tooltip formatter={(v) => [format(Number(v)), label]} cursor={{ fill: "rgba(74,43,232,0.06)" }} />
          <Bar dataKey="value" fill={COLORS[0]} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
      <DataTable rows={data} keys={[{ key: "value", label }]} currency={currency} />
    </>
  );
}

export function WorkerChart({ data }: { data: Row[] }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No workers yet</p>;
  return (
    <>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ right: 12, top: 8 }} barGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} />
          <YAxis width={28} allowDecimals={false} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgba(74,43,232,0.06)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="completed" name="Completed" fill={COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="active" name="Active" fill={COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
      <DataTable rows={data} keys={[{ key: "completed", label: "Completed" }, { key: "active", label: "Active" }]} />
    </>
  );
}
