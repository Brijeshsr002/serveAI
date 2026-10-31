import { cn } from "@/lib/utils";

/** Detailed side-view car, facing right. Decorative: the data it sits beside carries the meaning. */
export function CarGlyph({ color = "currentColor", className }: { color?: string; className?: string }) {
  return (
    <svg viewBox="0 0 120 46" className={className} aria-hidden="true">
      <ellipse cx="60" cy="41.500" rx="55" ry="3.500" fill="#000" opacity=".22" />
      {/* Body, with a lit upper panel and a shaded sill laid over the paint colour. */}
      <path d="M5 30c0-4 2-7 7-8l17-3 15-11c2-1.500 4.500-2.500 7-2.500h24c4 0 7.500 1.500 10 4.500l8 9.500 15 3c5 1 8 4 8 8v4c0 2-1.500 3.500-3.500 3.500h-104C6.500 38 5 36.500 5 34.500Z" fill={color} />
      <path d="M12 22l17-3 15-11c2-1.500 4.500-2.500 7-2.500h24c4 0 7.500 1.500 10 4.500l8 9.500 15 3c1.500.3 3 .8 4 1.500H7c1-1 3-1.700 5-2Z" fill="#fff" opacity=".16" />
      <path d="M5 31h110v3.500c0 2-1.500 3.500-3.500 3.500h-103C6.500 38 5 36.500 5 34.500Z" fill="#000" opacity=".28" />
      {/* Windows and pillar. */}
      <path d="M35 19.500 46.500 11c1.500-1 3-1.500 5-1.500h9.500v10Z" fill="#BAE6FD" />
      <path d="M64.500 9.500H75c3 0 5.500 1 7.500 3.500l5.500 6.500H64.500Z" fill="#BAE6FD" />
      <path d="M39 16.500 45 12c1-.7 2-1 3-1l-6 8.500Zm30-7h3l-3 10h-3Z" fill="#fff" opacity=".55" />
      {/* Door lines, handles and lights. */}
      <path d="M62.700 9.500V36M36 20v13" stroke="#000" strokeWidth=".7" opacity=".3" fill="none" />
      <rect x="51" y="23" width="6" height="1.400" rx=".7" fill="#fff" opacity=".7" />
      <rect x="77" y="23" width="6" height="1.400" rx=".7" fill="#fff" opacity=".7" />
      <path d="M108 25l6.500 1.500c.8.300 1 1 .7 1.900L114 30h-5c-1.500 0-2.500-1-2.500-2.500S107 25 108 25Z" fill="#FEF08A" />
      <path d="M5.500 26.500H11c.8 0 1.300.6 1.300 1.300v1.400c0 .7-.5 1.300-1.300 1.300H5Z" fill="#EF4444" />
      {[27, 93].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="35" r="8.500" fill="#0F172A" />
          <circle cx={cx} cy="35" r="5" fill="#CBD5E1" />
          <path d={`M${cx} 30v10M${cx - 5} 35h10M${cx - 3.500} 31.500l7 7M${cx + 3.500} 31.500l-7 7`} stroke="#64748B" strokeWidth="1" />
          <circle cx={cx} cy="35" r="1.500" fill="#334155" />
        </g>
      ))}
    </svg>
  );
}

/** A dark road with a car driving along it. Motion stops for people who ask for reduced motion. */
export function RoadScene({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-orange-950 text-white", className)}>
      <div className="relative z-10">{children}</div>
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-10 bg-slate-800">
        <div className="road-dashes absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2" />
        <CarGlyph color="#EA580C" className="car-drive absolute bottom-2 h-9 w-24" />
      </div>
    </div>
  );
}
