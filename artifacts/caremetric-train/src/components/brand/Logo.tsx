import { useId, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * CareMetric Train brand assets, rendered inline so they scale crisply and
 * survive printing without a network request. Standalone SVG files for
 * external use (emails, docs, OG images) live in public/: logo.svg (full
 * stacked lockup), logo-mark.svg (emblem only), favicon.svg.
 */

export const BRAND_BLUE = "#1d4fd7";
export const BRAND_ORANGE = "#f97316";

/** The emblem: open book + training screen with medical cross + rising road-arrow. */
export function LogoMark({ className }: { className?: string }) {
  const uid = useId();
  const road = `cmt-road-${uid}`;
  const frame = `cmt-frame-${uid}`;
  return (
    <svg
      viewBox="47 12 432 432"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="CareMetric Train emblem"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={road} x1="0.15" y1="1" x2="0.85" y2="0">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="55%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id={frame} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1e40af" />
        </linearGradient>
      </defs>

      {/* Monitor / screen */}
      <rect x="88" y="66" width="336" height="252" rx="38" fill="#ffffff" stroke={`url(#${frame})`} strokeWidth="18" />

      {/* Medical cross */}
      <path d="M150 112 h44 v46 h46 v44 h-46 v46 h-44 v-46 h-46 v-44 h46 Z" fill="#2563eb" />
      <rect x="118" y="262" width="96" height="11" rx="5.5" fill="#60a5fa" />
      <rect x="118" y="284" width="72" height="11" rx="5.5" fill="#93c5fd" />

      {/* Video panel with play button */}
      <rect x="302" y="106" width="94" height="88" rx="12" fill="#dbeafe" />
      <circle cx="349" cy="150" r="27" fill="#2563eb" />
      <path d="M341 136 l24 14 -24 14 Z" fill="#ffffff" />

      {/* Checklist panel */}
      <rect x="294" y="212" width="112" height="76" rx="12" fill="#e4eefc" />
      <path d="M308 234 l7 8 12 -14" stroke="#2563eb" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="336" y="230" width="58" height="9" rx="4.5" fill="#93c5fd" />
      <path d="M308 264 l7 8 12 -14" stroke="#2563eb" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="336" y="260" width="58" height="9" rx="4.5" fill="#93c5fd" />

      {/* Open book */}
      <path
        d="M256 336 C 214 306 148 298 64 314 L 64 376 C 148 362 214 370 256 404 C 298 370 364 362 448 376 L 448 314 C 364 298 298 306 256 336 Z"
        fill="#ffffff"
        stroke={`url(#${frame})`}
        strokeWidth="17"
        strokeLinejoin="round"
      />
      <path d="M86 356 C 154 348 212 356 252 382" stroke="#2563eb" strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M426 356 C 358 348 300 356 260 382" stroke="#2563eb" strokeWidth="9" strokeLinecap="round" fill="none" />

      {/* Rising road + arrow */}
      <path
        d="M 210 394 C 254 316 310 216 409 106 L 385 92 L 466 46 L 469 140 L 445 126 C 366 232 318 316 306 400 C 282 418 234 418 210 394 Z"
        fill={`url(#${road})`}
      />
      <path
        d="M 258 384 C 302 312 352 232 420 136"
        stroke="#ffffff"
        strokeWidth="11"
        strokeLinecap="round"
        strokeDasharray="26 26"
        fill="none"
      />
    </svg>
  );
}

/**
 * The two-tone brand name. "CareMetric" inherits the surrounding text color
 * (set it to white on dark surfaces, brand blue on light ones); "Train" is
 * always brand orange, matching the logo lockup.
 */
export function BrandName({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={className} style={style}>
      CareMetric <span style={{ color: BRAND_ORANGE }}>Train</span>
    </span>
  );
}
