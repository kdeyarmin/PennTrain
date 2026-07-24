import { chartColors } from "./tokens";

export interface RangeBarProps {
  /** Your facility's value. */
  value: number;
  /** Peer median. */
  p50: number;
  /** Optional peer interquartile band. */
  p25?: number;
  p75?: number;
  min?: number;
  max?: number;
  /** Whether a higher value is better (drives the marker color vs. the median). Default true. */
  higherIsBetter?: boolean;
  format?: (n: number) => string;
  label?: string;
  "aria-label"?: string;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

/**
 * "You vs. peers" benchmark bar: a peer interquartile band, a median tick, and your value as
 * a marker dot colored by whether you're on the good side of the median. Turns the Dashboard's
 * bare peer-benchmark numbers into an at-a-glance distribution read.
 */
export function RangeBar({
  value,
  p50,
  p25,
  p75,
  min = 0,
  max,
  higherIsBetter = true,
  format = (n) => n.toLocaleString(),
  label,
  "aria-label": ariaLabel,
}: RangeBarProps) {
  const computedHi = Math.max(value, p50, p75 ?? p50, p25 ?? p50) * 1.1;
  const hi = max ?? (computedHi || 1);
  const span = hi - min || 1;
  const pct = (v: number) => clampPct(((v - min) / span) * 100);

  const beating = higherIsBetter ? value >= p50 : value <= p50;
  const markerColor = beating ? chartColors.success : chartColors.warning;
  const hasBand = p25 != null && p75 != null;

  return (
    <div role="img" aria-label={ariaLabel ?? `${label ? label + ": " : ""}your value ${format(value)}, peer median ${format(p50)}`}>
      {label ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-semibold tabular-nums" style={{ color: markerColor }}>{format(value)}</span>
        </div>
      ) : null}
      <div className="relative h-2.5 rounded-full bg-muted">
        {hasBand ? (
          <div
            className="absolute inset-y-0 rounded-full bg-foreground/10"
            style={{ left: `${pct(p25!)}%`, width: `${Math.max(0, pct(p75!) - pct(p25!))}%` }}
          />
        ) : null}
        {/* Peer median tick */}
        <div
          className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded bg-muted-foreground/60"
          style={{ left: `${pct(p50)}%` }}
        />
        {/* Your value marker */}
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow"
          style={{ left: `${pct(value)}%`, backgroundColor: markerColor }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>Peer median {format(p50)}</span>
        {hasBand ? <span>Mid 50%: {format(p25!)}–{format(p75!)}</span> : null}
      </div>
    </div>
  );
}
