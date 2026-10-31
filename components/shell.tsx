"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Role } from "@prisma/client";
import {
  Activity, BarChart3, Car, CheckCircle2, CreditCard, FileText, LayoutDashboard, ListChecks, LogOut, Menu, MessageCircle,
  Search, Settings, ShieldCheck, Tags, User, Users, Wrench, X, type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

type NavItem = [string, string, LucideIcon];

const NAV: Record<Role, NavItem[]> = {
  ADMIN: [
    ["Dashboard", "/admin/dashboard", LayoutDashboard],
    ["Customers", "/admin/customers", Users],
    ["Vehicles", "/admin/vehicles", Car],
    ["Service Jobs", "/admin/jobs", ListChecks],
    ["Workers", "/admin/workers", Wrench],
    ["Receptionists", "/admin/receptionists", ShieldCheck],
    ["Payments", "/admin/payments", CreditCard],
    ["Invoices", "/admin/invoices", FileText],
    ["WhatsApp", "/admin/whatsapp", MessageCircle],
    ["Reports", "/admin/reports", BarChart3],
    ["Service Types", "/admin/service-types", Tags],
    ["Settings", "/admin/settings", Settings],
    ["Activity Logs", "/admin/activity", Activity],
  ],
  RECEPTIONIST: [
    ["Dashboard", "/reception/dashboard", LayoutDashboard],
    ["Customers", "/reception/customers", Users],
    ["Vehicles", "/reception/vehicles", Car],
    ["Service Jobs", "/reception/jobs", ListChecks],
    ["Payments", "/reception/payments", CreditCard],
    ["WhatsApp", "/reception/whatsapp", MessageCircle],
  ],
  WORKER: [
    ["My Jobs", "/worker/dashboard", ListChecks],
    ["Completed Jobs", "/worker/completed", CheckCircle2],
    ["Profile", "/worker/profile", User],
  ],
};

type SearchResults = {
  customers: { id: string; name: string; phone: string; customerCode: string }[];
  vehicles: { id: string; registrationNumber: string; brand: string; model: string }[];
  jobs: { id: string; serviceNumber: string; serviceType: string; status: string }[];
  invoices: { id: string; invoiceNumber: string }[];
};

function GlobalSearch({ base, canSeeInvoices }: { base: string; canSeeInvoices: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setResults(null);
    const timer = setTimeout(() => {
      api<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const groups: [string, { key: string; href: string; label: string }[]][] = results
    ? [
        ["Customers", results.customers.map((c) => ({ key: c.id, href: `${base}/customers/${c.id}`, label: `${c.name} · +${c.phone}` }))],
        ["Vehicles", results.vehicles.map((v) => ({ key: v.id, href: `${base}/vehicles/${v.id}`, label: `${v.registrationNumber} · ${v.brand} ${v.model}` }))],
        ["Services", results.jobs.map((j) => ({ key: j.id, href: `${base}/jobs/${j.id}`, label: `${j.serviceNumber} · ${j.serviceType}` }))],
        ["Invoices", results.invoices.map((i) => ({ key: i.id, href: canSeeInvoices ? `${base}/invoices/${i.id}` : `/api/invoices/${i.id}/pdf`, label: i.invoiceNumber }))],
      ]
    : [];
  const empty = results && groups.every(([, items]) => items.length === 0);

  return (
    <div className="relative w-full max-w-md">
      <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label="Search customers, vehicles, services, invoices"
        placeholder="Search name, phone, TN38AB1234, SRV-…, INV-…"
        className="pl-8"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results && (
        <div className="absolute z-30 mt-1 max-h-96 w-full overflow-auto rounded-lg border bg-popover p-2 text-sm shadow-lg">
          {empty && <p className="p-2 text-muted-foreground">No matches</p>}
          {groups.filter(([, items]) => items.length).map(([title, items]) => (
            <div key={title} className="mb-1">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{title}</p>
              {items.map((item) => (
                <a key={item.key} href={item.href} className="block rounded px-2 py-1.5 hover:bg-accent">{item.label}</a>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Shell({ role, name, children }: { role: Role; name: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = NAV[role];
  const base = role === "ADMIN" ? "/admin" : role === "RECEPTIONIST" ? "/reception" : "/worker";

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Main">
      <Logo className="mb-4 ml-1 h-9 self-start" />
      {items.map(([label, href, Icon]) => {
        const active = pathname === href || (href !== `${base}/dashboard` && pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent",
              active && "bg-sidebar-accent text-sidebar-primary",
            )}
          >
            <Icon className="size-4" /> {label}
          </Link>
        );
      })}
      <div className="mt-auto border-t pt-3">
        <p className="truncate px-2.5 text-sm font-medium">{name}</p>
        <p className="mb-2 px-2.5 text-xs text-muted-foreground capitalize">{role.toLowerCase()}</p>
        <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-sidebar-accent">
          <LogOut className="size-4" /> Log out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 overflow-y-auto border-r bg-sidebar lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 overflow-y-auto bg-sidebar">
            <button aria-label="Close menu" className="absolute top-3 right-3 p-1" onClick={() => setOpen(false)}><X className="size-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background px-4 py-2.5">
          <button aria-label="Open menu" className="p-1 lg:hidden" onClick={() => setOpen(true)}><Menu className="size-5" /></button>
          {role === "WORKER" ? <Logo className="h-7 lg:hidden" /> : <GlobalSearch base={base} canSeeInvoices={role === "ADMIN"} />}
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
