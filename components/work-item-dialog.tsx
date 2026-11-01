"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SELECT_CLASS } from "@/components/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client";
import { ISSUE_NAMES, PART_NAMES, WORK_NAMES } from "@/lib/work-catalog";

type ItemType = "PART" | "LABOUR" | "SERVICE";
export type WorkItem = { id: string; itemType: ItemType; name: string; quantity: number; unitPrice: number };

const groups = (parts: string[]): { title: string; type: ItemType; names: string[] }[] => [
  { title: "Issues found", type: "LABOUR", names: ISSUE_NAMES },
  { title: "Services", type: "SERVICE", names: WORK_NAMES },
  { title: "Parts", type: "PART", names: [...new Set([...PART_NAMES, ...parts])] },
];

/** Tap a listed issue, service or part, or type your own, then enter the amount. */
export function WorkItemDialog({ jobId, item, trigger, triggerLabel, triggerSize = "sm", variant = "default", className, prices = {}, parts = [], staff = false }: {
  jobId: string;
  item?: WorkItem;
  trigger: React.ReactNode;
  triggerLabel?: string;
  triggerSize?: "sm" | "lg" | "icon-sm";
  variant?: "default" | "outline" | "ghost";
  className?: string;
  /** Name to amount: approved rates, then the price list in Settings. */
  prices?: Record<string, number>;
  /** Parts added in Service Types, on top of the built-in names. */
  parts?: string[];
  /** Staff choose whether to ask the customer; a worker's work always asks. */
  staff?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item?.name ?? "");
  const [itemType, setItemType] = useState<ItemType>(item?.itemType ?? "SERVICE");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [unitPrice, setUnitPrice] = useState(item ? String(item.unitPrice) : "");
  const [needsApproval, setNeedsApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/service-jobs/${jobId}/items${item ? `/${item.id}` : ""}`;

  function reset() {
    setName(item?.name ?? "");
    setItemType(item?.itemType ?? "SERVICE");
    setQuantity(String(item?.quantity ?? 1));
    setUnitPrice(item ? String(item.unitPrice) : "");
    setError("");
  }

  function pick(n: string, type: ItemType) {
    setName(n);
    setItemType(type);
    setUnitPrice(prices[n] !== undefined ? String(prices[n]) : "");
  }

  async function run(call: () => Promise<string>) {
    setBusy(true);
    setError("");
    try {
      toast.success(await call());
      setOpen(false);
      if (!item) reset();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) reset(); }}>
      <DialogTrigger render={<Button variant={variant} size={triggerSize} aria-label={triggerLabel} title={triggerLabel} className={className} />}>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{item ? `Edit ${item.name}` : "Add issue, service or part"}</DialogTitle></DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const body = { itemType, name, quantity, unitPrice, ...(staff ? { needsApproval, notifyCustomer: true } : {}) };
            void run(async () => {
              const saved = await api<{ approvalRequested?: boolean }>(endpoint, { method: item ? "PATCH" : "POST", body });
              return saved?.approvalRequested ? "Sent to the customer for approval" : "Saved";
            });
          }}
        >
          {groups(parts).map((group) => (
            <details key={group.title} open={group.title === "Issues found"} className="rounded-lg border p-2 text-sm">
              <summary className="cursor-pointer font-medium">{group.title}</summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {group.names.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={name === n}
                    onClick={() => pick(n, group.type)}
                    className={`rounded-full border px-2.5 py-1 text-xs hover:bg-accent ${name === n ? "border-primary bg-accent font-medium text-accent-foreground" : ""}`}
                  >
                    {n}{prices[n] !== undefined && <span className="ml-1 text-muted-foreground">₹{prices[n]}</span>}
                  </button>
                ))}
              </div>
            </details>
          ))}
          <div className="space-y-1">
            <Label htmlFor={`${endpoint}-name`}>Name (tap above or type your own)</Label>
            <Input id={`${endpoint}-name`} required maxLength={160} value={name} onChange={(e) => { setName(e.target.value); if (prices[e.target.value] !== undefined) setUnitPrice(String(prices[e.target.value])); }} placeholder="e.g. Rear bumper scratch" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor={`${endpoint}-type`}>Type</Label>
              <select id={`${endpoint}-type`} className={SELECT_CLASS} value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
                <option value="SERVICE">Service</option>
                <option value="LABOUR">Labour</option>
                <option value="PART">Part</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${endpoint}-qty`}>Quantity</Label>
              <Input id={`${endpoint}-qty`} type="number" min="0.01" step="any" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${endpoint}-price`}>Amount (₹)</Label>
              <Input id={`${endpoint}-price`} type="number" min="0" step="any" required value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
          </div>
          {staff && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={needsApproval} onChange={(e) => setNeedsApproval(e.target.checked)} />
              Ask the customer to approve first (not billed until they say yes)
            </label>
          )}
          {quantity && unitPrice && <p className="text-right text-sm font-semibold">Amount: ₹{new Intl.NumberFormat("en-IN").format(Number(quantity) * Number(unitPrice))}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : staff ? "Save" : item ? "Save (customer approves any change)" : "Send to customer for approval"}</Button>
          {item && (
            <Button
              type="button"
              variant="ghost"
              className="w-full text-destructive"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove ${item.name}? The customer will be told on WhatsApp.`)) void run(async () => {
                  await api(endpoint, { method: "DELETE" });
                  return "Removed";
                });
              }}
            >
              Remove
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
