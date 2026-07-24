import { useId } from "react";
import { chartColors } from "./tokens";

export interface TrendSeries {
  name: string;
  color?: string;
  points: { x: string | number; y: number }[];
}

export interface TrendLineProps {
  series: TrendSeries[];
  height?: number;
  yFormat?: (n: number) => string;
  xFormat?: (x: string | number) => string;
  showGrid?: boolean;
  showLegend?: boolean;
  className?: string;
  "aria-label"?: string;
}

const DEFAULT_COLORS = [chartColors.primary, chartColors.success, chartColors.warning, chartColors.info, chartColors.danger];
const VIEW_W = 640;
const M = { top: 12, right: 14, bottom: 26, left: 44 };

/**
 * Responsive multi-series line chart (SVG, viewBox-scaled with non-scaling strokes so lines
 * stay crisp at any width). Light gridlines + y-axis ticks + a small legend. Assumes each
 * series shares the same ordered x categories (index-aligned).
 */
export function TrendLine({
  series,
  height = 240,
  yFormat = (n) => n.toLocaleString(),
  xFormat = (x) => String(x),
  showGrid = true,
  showLegend = true,
  className,
  "aria-label": ariaLabel,
}: TrendLineProps) {
  const clipId = useId();
  const usable = (series ?? []).filter((s) => s.points && s.points.length > 0);
  if (usable.length === 0) return null;

  const len = Math.max(...usable.map((s) => s.points.length));
  const allY = usable.flatMap((s) => s.points.map((p) => p.y));
  let yMin = Math.min(...allY);
  let yMax = Math.max(...allY);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  // Give the top a little headroom and pin the floor to 0 when all values are non-negative.
  yMax = yMax + (yMax - yMin) * 0.08;
  if (yMin >= 0) yMin = 0;

  const plotW = VIEW_W - M.left - M.right;
  const plotH = height - M.top - M.bottom;
  const xAt = (i: number) => M.left + (len > 1 ? (i / (len - 1)) * plotW : plotW / 2);
  const yAt = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);

  const xLabels = usable[0].points;
  const labelEvery = Math.ceil(len / 6);

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={ariaLabel ?? `Trend of ${usable.map((s) => s.name).join(", ")}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={M.left} y={M.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {showGrid
          ? gridVals.map((v, i) => (
              <g key={i}>
                <line x1={M.left} x2={VIEW_W - M.right} y1={yAt(v)} y2={yAt(v)} stroke={chartColors.grid} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <text x={M.left - 8} y={yAt(v) + 3} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 10 }}>
                  {yFormat(v)}
                </text>
              </g>
            ))
          : null}

        {xLabels.map((p, i) =>
          i % labelEvery === 0 || i === len - 1 ? (
            <text key={i} x={xAt(i)} y={height - 8} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>
              {xFormat(p.x)}
            </text>
          ) : null,
        )}

        <g clipPath={`url(#${clipId})`}>
          {usable.map((s, si) => {
            const stroke = s.color ?? DEFAULT_COLORS[si % DEFAULT_COLORS.length];
            const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yAt(p.y).toFixed(2)}`).join(" ");
            return (
              <g key={s.name}>
                <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                {s.points.map((p, i) => (
                  <circle key={i} cx={xAt(i)} cy={yAt(p.y)} r={2.4} fill={stroke} />
                ))}
              </g>
            );
          })}
        </g>
      </svg>

      {showLegend && usable.length > 1 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {usable.map((s, si) => (
            <div key={s.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color ?? DEFAULT_COLORS[si % DEFAULT_COLORS.length] }} />
              {s.name}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
