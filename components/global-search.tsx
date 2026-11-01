"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";

type SearchResults = {
  customers: { id: string; name: string; phone: string }[];
  vehicles: { id: string; registrationNumber: string; brand: string; model: string }[];
};

const SEARCH_HINT = "Search name, phone or vehicle number";

export function GlobalSearch({ base }: { base: string }) {
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
        className="bg-background pl-8"
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
