import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export const BRAND_TAGLINE = "Car service management";

/** The garage's own name, set in Settings, shown wherever the app identifies itself. */
export function Logo({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2 font-semibold", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Wrench className="size-4" /></span>
      <span className="min-w-0 truncate" style={{ fontFamily: "var(--font-logo), system-ui, sans-serif" }}>{name}</span>
    </span>
  );
}
