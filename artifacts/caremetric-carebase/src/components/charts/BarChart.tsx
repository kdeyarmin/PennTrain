import { chartColors } from "./tokens";

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  /** Height of the plot area in vertical mode (px). */
  height?: number;
  /** Axis maximum. Defaults to the largest value in `data`. */
  max?: number;
  horizontal?: boolean;
  color?: string;
  showValues?: boolean;
  valueFormat?: (n: number) => string;
  className?: string;
  "aria-label"?: string;
}

/**
 * A minimal bar chart built from CSS bars (not SVG) so labels stay crisp and it reflows
 * responsively. Token-driven by default; per-bar `color` overrides are supported.
 */
export function BarChart({
  data,
  height = 180,
  max,
  horizontal = false,
  color = chartColors.primary,
  showValues = true,
  valueFormat = (n) => n.toLocaleString(),
  className,
  "aria-label": ariaLabel,
}: BarChartProps) {
  if (!data || data.length === 0) return null;
  const ceiling = max ?? Math.max(...data.map((d) => d.value), 1);
  const label = ariaLabel ?? "Bar chart";

  if (horizontal) {
    return (
      <div className={className} role="img" aria-label={label}>
        <div className="space-y-2.5">
          {data.map((d) => {
            const pct = Math.max(0, Math.min(100, (d.value / ceiling) * 100));
            return (
              <div key={d.label} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate text-muted-foreground" title={d.label}>{d.label}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full ease-out motion-safe:transition-[width] motion-safe:duration-500"
                    style={{ width: `${pct}%`, backgroundColor: d.color ?? color }}
                  />
                </div>
                {showValues ? <span className="tabular-nums text-right font-medium">{valueFormat(d.value)}</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={className} role="img" aria-label={label}>
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((d) => {
          const pct = Math.max(0, Math.min(100, (d.value / ceiling) * 100));
          return (
            <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              {showValues ? <span className="tabular-nums text-xs font-medium">{valueFormat(d.value)}</span> : null}
              <div
                className="w-full rounded-t-md ease-out motion-safe:transition-[height] motion-safe:duration-500"
                style={{ height: `${pct}%`, minHeight: d.value > 0 ? 4 : 0, backgroundColor: d.color ?? color }}
              />
              <span className="max-w-full truncate text-[11px] text-muted-foreground" title={d.label}>{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
