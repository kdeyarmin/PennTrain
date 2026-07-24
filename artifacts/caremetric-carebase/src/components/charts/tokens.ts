/**
 * Chart palette — every chart in the kit draws from these so a single token change in
 * index.css recolors all visualizations, and so charts match the rest of the app (no more
 * inline #10b981/#f59e0b/#ef4444 hex like the Dashboard donut used to carry). HSL var refs
 * work anywhere SVG accepts a color (fill/stroke).
 */
export const chartColors = {
  primary: "hsl(var(--primary))",
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  danger: "hsl(var(--destructive))",
  info: "hsl(var(--info))",
  track: "hsl(var(--muted))",
  grid: "hsl(var(--border))",
  axis: "hsl(var(--muted-foreground))",
} as const;

/** Compliance-style threshold color: green ≥90, amber ≥75, red below. */
export function complianceColor(pct: number): string {
  return pct >= 90 ? chartColors.success : pct >= 75 ? chartColors.warning : chartColors.danger;
}

/** A soft tinted track that pairs with complianceColor at the same threshold. */
export function complianceTrack(pct: number): string {
  return pct >= 90
    ? "hsl(var(--success) / 0.15)"
    : pct >= 75
      ? "hsl(var(--warning) / 0.15)"
      : "hsl(var(--destructive) / 0.15)";
}
