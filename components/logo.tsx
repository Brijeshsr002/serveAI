export const BRAND_NAME = "ServAI";
export const BRAND_TAGLINE = "AI-Powered Service Management";

const NAVY = "#0B1033";
const VIOLET = "#4A2BE8";

/** Vector redraw of the ServAI logo: navy "Serv", violet "AI" with the robot face inside the A. */
export function Logo({ className, tagline = false }: { className?: string; tagline?: boolean }) {
  return (
    <svg viewBox={tagline ? "0 0 276 104" : "0 0 276 78"} className={className} role="img" aria-label={BRAND_NAME}>
      <text
        x="0"
        y="70"
        textLength="168"
        lengthAdjust="spacingAndGlyphs"
        fill={NAVY}
        style={{ fontFamily: "var(--font-logo), system-ui, sans-serif", fontWeight: 700, fontSize: 80 }}
      >
        Serv
      </text>
      <LogoMarkShapes offsetX={166} />
      <rect x="254" y="12" width="13" height="58" fill={VIOLET} />
      {tagline && (
        <text
          x="138"
          y="98"
          textAnchor="middle"
          textLength="262"
          lengthAdjust="spacing"
          fill={NAVY}
          style={{ fontFamily: "var(--font-logo), system-ui, sans-serif", fontWeight: 500, fontSize: 15 }}
        >
          {BRAND_TAGLINE}
        </text>
      )}
    </svg>
  );
}

function LogoMarkShapes({ offsetX }: { offsetX: number }) {
  return (
    <g transform={`translate(${offsetX} 0)`}>
      <path d="M6 70 L41 13 L76 70" fill="none" stroke={VIOLET} strokeWidth="13" strokeLinejoin="round" />
      <rect x="26" y="49" width="30" height="21" rx="8" fill={VIOLET} />
      <rect x="33" y="55" width="6" height="9" rx="3" fill="#fff" />
      <rect x="43" y="55" width="6" height="9" rx="3" fill="#fff" />
    </g>
  );
}
