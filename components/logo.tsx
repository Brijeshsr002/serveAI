import { cn } from "@/lib/utils";

export const CRM_NAME = "ServAI";
export const BRAND_TAGLINE = "AI-Powered Service Management";

const VIOLET = "#4A2BE8";

/** The ServAI wordmark. `light` is for dark backgrounds. */
export function ServAiLogo({ className, light = false }: { className?: string; light?: boolean }) {
  const ink = light ? "#FFFFFF" : "#0B1033";
  const accent = light ? "#A897FF" : VIOLET;
  return (
    <svg viewBox="0 0 276 78" className={className} role="img" aria-label={CRM_NAME}>
      <text x="0" y="70" textLength="168" lengthAdjust="spacingAndGlyphs" fill={ink} style={{ fontFamily: "var(--font-logo), system-ui, sans-serif", fontWeight: 700, fontSize: 80 }}>Serv</text>
      <g transform="translate(166 0)">
        <path d="M6 70 L41 13 L76 70" fill="none" stroke={accent} strokeWidth="13" strokeLinejoin="round" />
        <rect x="26" y="49" width="30" height="21" rx="8" fill={accent} />
        <rect x="33" y="55" width="6" height="9" rx="3" fill={light ? "#0B1033" : "#fff"} />
        <rect x="43" y="55" width="6" height="9" rx="3" fill={light ? "#0B1033" : "#fff"} />
      </g>
      <rect x="254" y="12" width="13" height="58" fill={accent} />
    </svg>
  );
}

/** ServAI, with the garage it is running for. */
export function Logo({ name, className, light = false, logoClassName }: { name: string; className?: string; light?: boolean; logoClassName?: string }) {
  return (
    <span className={cn("flex min-w-0 flex-col gap-1", className)}>
      <ServAiLogo light={light} className={cn("h-8 w-auto self-start", logoClassName)} />
      <span className="truncate text-[0.72em] font-medium opacity-80"><span aria-label="in collaboration with">×</span> {name}</span>
    </span>
  );
}
