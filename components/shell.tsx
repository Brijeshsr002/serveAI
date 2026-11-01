"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Role } from "@prisma/client";
import {
  Activity, BarChart3, CalendarCheck, CheckCircle2, CreditCard, FileText, LayoutDashboard, ListChecks, LogOut, Menu, MessageCircle, MessageSquareText,
  Search, Settings, ShieldCheck, Tags, User, Users, Wrench, X, type LucideIcon,
} from "lucide-react";
import { FormDialog } from "@/components/actions";
import { customerFields } from "@/components/forms-config";
import { Input } from "@/components/ui/input";
import { LiveRefresh } from "@/components/live-refresh";
import { Logo } from "@/components/logo";
import { NotificationBell } from "@/components/notification-bell";
import { LATEST_VERSION } from "@/lib/changelog";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

type NavItem = [string, string, LucideIcon];

const NAV: Record<Role, NavItem[]> = {
  ADMIN: [
    ["Dashboard", "/admin/dashboard", LayoutDashboard],
    ["Customers", "/admin/customers", Users],
    ["Kanban Board", "/admin/jobs", ListChecks],
    ["Workers", "/admin/workers", Wrench],
    ["Receptionists", "/admin/receptionists", ShieldCheck],
    ["Attendance", "/admin/attendance", CalendarCheck],
    ["Payments", "/admin/payments", CreditCard],
    ["Invoices", "/admin/invoices", FileText],
    ["WhatsApp", "/admin/whatsapp", MessageCircle],
    ["Reports", "/admin/reports", BarChart3],
    ["Service Types", "/admin/service-types", Tags],
    ["Customer Messages", "/admin/messages", MessageSquareText],
    ["Settings", "/admin/settings", Settings],
    ["Activity Logs", "/admin/activity", Activity],
  ],
  RECEPTIONIST: [
    ["Dashboard", "/reception/dashboard", LayoutDashboard],
    ["Customers", "/reception/customers", Users],
    ["Kanban Board", "/reception/jobs", ListChecks],
    ["Service Rates", "/reception/service-rates", Tags],
    ["Payments", "/reception/payments", CreditCard],
    ["WhatsApp", "/reception/whatsapp", MessageCircle],
    ["Profile", "/reception/profile", User],
  ],
  WORKER: [
    ["My Jobs", "/worker/dashboard", ListChecks],
    ["Completed Jobs", "/worker/completed", CheckCircle2],
    ["Service Rates", "/worker/service-rates", Tags],
    ["Profile", "/worker/profile", User],
  ],
};

type SearchResults = {
  customers: { id: string; name: string; phone: string }[];
  vehicles: { id: string; registrationNumber: string; brand: string; model: string }[];
};

const SEARCH_HINT = "Search name, phone or vehicle number";

function GlobalSearch({ base }: { base: string }) {
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
      ]
    : [];
  const empty = results && groups.every(([, items]) => items.length === 0);

  return (
    <div className="relative w-full max-w-md">
      <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label={SEARCH_HINT}
        placeholder={SEARCH_HINT}
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

export function Shell({ role, name, garage, children }: { role: Role; name: string; garage: string; children: React.ReactNode }) {
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
      <Logo name={garage} light className="mb-4 ml-1 text-sm text-sidebar-foreground" />
      {items.map(([label, href, Icon]) => {
        // A vehicle's detail page belongs to Customers now that the two share a page.
        const active = pathname === href || (href !== `${base}/dashboard` && pathname.startsWith(`${href}/`)) || (href === `${base}/customers` && pathname.startsWith(`${base}/vehicles/`));
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
      <div className="mt-auto border-t border-sidebar-border pt-3 text-sidebar-foreground">
        <p className="truncate px-2.5 text-sm font-medium">{name}</p>
        <p className="mb-2 px-2.5 text-xs text-sidebar-foreground/70 capitalize">{role.toLowerCase()}</p>
        <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-sidebar-accent">
          <LogOut className="size-4" /> Log out
        </button>
        {role === "ADMIN" && (
          <Link href="/admin/updates" onClick={() => setOpen(false)} className="mt-1 block rounded px-2.5 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:underline">v{LATEST_VERSION}</Link>
        )}
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
          {role === "WORKER" ? <Logo name={garage} className="text-xs lg:hidden" logoClassName="h-6" /> : <GlobalSearch base={base} />}
          {role !== "WORKER" && (
            <div className="ml-auto shrink-0">
              <FormDialog trigger="+ Add customer" title="Add customer" endpoint="/api/customers" fields={customerFields} success="Customer added" redirectTo={`${base}/customers/:id`} />
            </div>
          )}
          <LiveRefresh className={role === "WORKER" ? "ml-auto" : undefined} />
          <NotificationBell />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
