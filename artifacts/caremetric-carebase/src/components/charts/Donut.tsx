import type { ReactNode } from "react";
import { complianceColor, complianceTrack } from "./tokens";

export interface DonutProps {
  /** Current value, 0..max. */
  value: number;
  /** Defaults to 100 (percentage). */
  max?: number;
  size?: number;
  strokeWidth?: number;
  /** Ring color, or a function of the computed percentage. Defaults to the compliance ramp. */
  color?: string | ((pct: number) => string);
  /** Track (background ring) color. Defaults to a soft tint matching `color`. */
  trackColor?: string;
  /** Center headline. Defaults to `${pct}%`. */
  label?: ReactNode;
  /** Small line under the headline. Defaults to "Compliant". */
  sublabel?: ReactNode;
  "aria-label"?: string;
}

/**
 * A single-value progress ring (SVG). Extracted and generalized from the Dashboard's inline
 * DonutChart so the compliance ring is reusable and fully token-driven. Keeps the original
 * −90° start, round line caps, and the slow fill transition.
 */
export function Donut({
  value,
  max = 100,
  size = 140,
  strokeWidth = 12,
  color,
  trackColor,
  label,
  sublabel = "Compliant",
  "aria-label": ariaLabel,
}: DonutProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const resolvedColor = typeof color === "function" ? color(pct) : (color ?? complianceColor(pct));
  const resolvedTrack = trackColor ?? complianceTrack(pct);
  const rounded = Math.round(pct);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel ?? `${rounded} percent`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={resolvedTrack} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={resolvedColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="ease-out motion-safe:transition-all motion-safe:duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tracking-tight" style={{ color: resolvedColor }}>
          {label ?? `${rounded}%`}
        </span>
        {sublabel ? <span className="text-[10px] font-medium text-muted-foreground">{sublabel}</span> : null}
      </div>
    </div>
  );
}
