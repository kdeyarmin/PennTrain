import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * CareMetric Train brand assets. The emblem is a raster mark (public/logo-mark.png);
 * other standalone files for external use (emails, docs, OG images) live in
 * public/ too: logo.png (full stacked lockup), favicon.png.
 */

export const BRAND_BLUE = "#1d4fd7";
export const BRAND_ORANGE = "#f97316";

/**
 * The emblem: nurse silhouette with a laptop showing an open book.
 *
 * Decorative by default (`aria-hidden`), since it almost always sits next to the
 * visible "CareMetric Train" text and a name here would make screen readers
 * announce the brand twice. Pass `label` only when the mark stands alone and
 * needs its own accessible name.
 */
export function LogoMark({ className, label }: { className?: string; label?: string }) {
  return (
    <img
      src="/logo-mark.png"
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0 object-contain", className)}
    />
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
