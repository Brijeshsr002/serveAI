"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { Role } from "@prisma/client";
import {
  Activity, CheckCircle2, CreditCard, LayoutDashboard, ListChecks, LogOut, Menu, MessageCircle,
  Settings, Tags, User, UserCog, Users, X, type LucideIcon,
} from "lucide-react";
import { AutoRefresh } from "@/components/live-refresh";
import { Logo } from "@/components/logo";
import { NotificationBell } from "@/components/notification-bell";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

type NavItem = [string, string, LucideIcon];

const NAV: Record<Role, NavItem[]> = {
  ADMIN: [
    ["Dashboard", "/admin/dashboard", LayoutDashboard],
    ["Customers & Jobs", "/admin/customers-jobs", Users],
    ["Employees", "/admin/employees", UserCog],
    ["Billing", "/admin/billing", CreditCard],
    ["WhatsApp", "/admin/whatsapp", MessageCircle],
    ["Service Types", "/admin/service-types", Tags],
    ["Settings", "/admin/settings", Settings],
    ["Activity Logs", "/admin/activity", Activity],
  ],
  RECEPTIONIST: [
    ["Dashboard", "/reception/dashboard", LayoutDashboard],
    ["Customers & Jobs", "/reception/customers-jobs", Users],
    ["Billing", "/reception/billing", CreditCard],
    ["WhatsApp", "/reception/whatsapp", MessageCircle],
    ["Service Rates", "/reception/service-rates", Tags],
    ["Profile", "/reception/profile", User],
  ],
  WORKER: [
    ["My Jobs", "/worker/dashboard", ListChecks],
    ["Completed Jobs", "/worker/completed", CheckCircle2],
    ["Service Rates", "/worker/service-rates", Tags],
    ["Profile", "/worker/profile", User],
  ],
};

/** Pages with no menu item of their own light up the item they sit under. */
export function navActive(href: string, pathname: string, base: string) {
  return pathname === href
    || (href !== `${base}/dashboard` && pathname.startsWith(`${href}/`))
    || (href === `${base}/customers-jobs` && ["customers", "jobs", "vehicles"].some((page) => pathname.startsWith(`${base}/${page}/`)))
    || (href === "/admin/employees" && pathname.startsWith("/admin/staff/"))
    || (href === "/admin/billing" && pathname.startsWith("/admin/invoices/"))
    || (href === "/admin/whatsapp" && pathname === "/admin/messages")
    || (href === "/admin/settings" && pathname === "/admin/updates");
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
        const active = navActive(href, pathname, base);
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
        <div className="mb-2 flex items-center gap-2 px-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-xs text-sidebar-foreground/70 capitalize">{role.toLowerCase()}</p>
          </div>
          <NotificationBell onNavigate={() => setOpen(false)} />
        </div>
        <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-sidebar-accent">
          <LogOut className="size-4" /> Log out
        </button>
      </div>
    </nav>
  );

  // One sidebar for desktop and the phone drawer, so there is only ever one bell. No transform on it: the bell's list is
  // fixed to the screen to get out of this scrolling box, and a transform would trap it again.
  return (
    <div className="flex min-h-screen bg-muted/30">
      <AutoRefresh />
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={cn(
        "overflow-y-auto bg-sidebar lg:sticky lg:top-0 lg:z-30 lg:block lg:h-screen lg:w-56 lg:shrink-0 lg:border-r",
        open ? "fixed inset-y-0 left-0 z-50 w-64" : "hidden",
      )}>
        {open && <button aria-label="Close menu" className="absolute top-3 right-3 p-1 text-sidebar-foreground lg:hidden" onClick={() => setOpen(false)}><X className="size-5" /></button>}
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background px-4 py-2 lg:hidden">
          <button aria-label="Open menu" className="p-1" onClick={() => setOpen(true)}><Menu className="size-5" /></button>
          <Logo name={garage} className="text-xs" logoClassName="h-6" />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
