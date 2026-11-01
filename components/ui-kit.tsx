import Link from "next/link";
import type { PaymentStatus, ServiceStatus } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PAYMENT_COLOR, STATUS_COLOR, STATUS_LABEL } from "@/lib/status";

export function StatusBadge({ status }: { status: ServiceStatus }) {
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_COLOR[status])}>{STATUS_LABEL[status]}</span>;
}

export function PaymentBadge({ status }: { status: PaymentStatus | "UNPAID" }) {
  const color = status === "UNPAID" ? "bg-slate-100 text-slate-700" : PAYMENT_COLOR[status];
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", color)}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}

/** Only shows for lines that aren't on the bill yet. */
export function ApprovalBadge({ approval }: { approval: "APPROVED" | "PENDING" | "DECLINED" }) {
  if (approval === "APPROVED") return null;
  return (
    <span className={cn("ml-1.5 inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-medium whitespace-nowrap", approval === "PENDING" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600")}>
      {approval === "PENDING" ? "Waiting for customer" : "Declined"}
    </span>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <Card size="sm" className={cn(tone && "border-t-4", tone)}>
      <CardContent>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold break-words tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function SimpleTable({ headers, rows, rowKeys, empty = "Nothing here yet" }: {
  headers: string[];
  rows: React.ReactNode[][];
  /** One record id per row. Needed when a row holds a dialog or anything else with state, so that state follows its record when rows shift. */
  rowKeys?: string[];
  empty?: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>{headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={rowKeys?.[i] ?? i}>{row.map((cell, j) => <TableCell key={j}>{cell}</TableCell>)}</TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="font-medium text-primary hover:underline">{children}</Link>;
}

/** A plain GET form, so list search needs no client code. */
export function SearchForm({ q, placeholder, view }: { q?: string; placeholder: string; view?: string }) {
  return (
    <form method="get" className="mb-4 max-w-sm">
      {view && <input type="hidden" name="view" value={view} />}
      <Input name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{children || "—"}</dd>
    </div>
  );
}
