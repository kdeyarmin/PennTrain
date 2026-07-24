import { useId } from "react";
import { chartColors } from "./tokens";

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Draw a soft gradient area under the line. */
  fill?: boolean;
  /** Emphasize the latest point with a dot. */
  showEndDot?: boolean;
  strokeWidth?: number;
  className?: string;
  "aria-label"?: string;
}

/**
 * Tiny inline trend line for KPI tiles. No axes, no chrome — just the shape of the recent
 * trend. Flat-line safe (a single value or all-equal values render a centered line).
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = chartColors.primary,
  fill = true,
  showEndDot = true,
  strokeWidth = 1.5,
  className,
  "aria-label": ariaLabel,
}: SparklineProps) {
  const gradientId = useId();
  if (!data || data.length === 0) return null;

  const pad = strokeWidth + 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data.map((v, i) => {
    const x = pad + (data.length > 1 ? i * stepX : innerW / 2);
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(2)},${(height - pad).toFixed(2)} L${points[0][0].toFixed(2)},${(height - pad).toFixed(2)} Z`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={ariaLabel ?? "Trend"}>
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {showEndDot ? <circle cx={lastX} cy={lastY} r={strokeWidth + 0.8} fill={color} /> : null}
    </svg>
  );
}
