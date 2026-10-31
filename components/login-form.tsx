"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client";

const DEV_ACCOUNTS = [
  ["Admin", "admin@serveai.local"],
  ["Reception", "reception@serveai.local"],
  ["Worker", "worker1@serveai.local"],
];

export function LoginForm({ showDevAccounts }: { showDevAccounts: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ redirectTo: string }>("/api/auth/login", { method: "POST", body: { email, password } });
      window.location.href = data.redirectTo;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Logging in…" : "Log in"}</Button>
      {showDevAccounts && (
        <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          <p className="mb-2 font-medium">Development accounts (seeded; password in README)</p>
          <div className="flex flex-wrap gap-1.5">
            {DEV_ACCOUNTS.map(([label, value]) => (
              <button key={value} type="button" onClick={() => setEmail(value)} className="rounded border bg-background px-2 py-1 hover:bg-accent">
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
