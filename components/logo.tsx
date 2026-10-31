import { cn } from "@/lib/utils";

export const CRM_NAME = "ServeAI";
export const BRAND_TAGLINE = "Premium car care, powered by ServeAI";

/** CS monogram under a car roofline. The favicon and invoice draw the same mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("size-9 shrink-0", className)} role="img" aria-hidden="true">
      <rect width="48" height="48" rx="11" fill="#C2410C" />
      <path d="M7 20c6 0 8-9 17-9s11 7 17 9" fill="none" stroke="#fff" strokeWidth="2.600" strokeLinecap="round" />
      <text x="24" y="38" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="700" letterSpacing="0.5" style={{ fontFamily: "var(--font-logo), system-ui, sans-serif" }}>CS</text>
    </svg>
  );
}

/** Company name and mark, with the ServeAI collaboration line underneath. */
export function Logo({ name, className, markClassName }: { name: string; className?: string; markClassName?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <LogoMark className={markClassName} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-bold tracking-tight" style={{ fontFamily: "var(--font-logo), system-ui, sans-serif" }}>{name}</span>
        <span className="block text-[0.68em] font-medium opacity-75"><span aria-label="in collaboration with">×</span> {CRM_NAME}</span>
      </span>
    </span>
  );
}
