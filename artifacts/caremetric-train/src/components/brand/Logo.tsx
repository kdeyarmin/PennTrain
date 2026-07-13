import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * CareMetric CareBase brand assets. The emblem is a vector mark (public/logo-mark.svg);
 * other standalone files for external use (emails, docs, OG images) live in
 * public/ too: logo.svg (full stacked lockup), logo-mark.svg.
 */

export const BRAND_BLUE = "#1d4fd7";
export const BRAND_GRAY = "#59616d";

/**
 * The emblem: nurse, stethoscope, home, and circuit motif from the CareBase mark.
 *
 * Decorative by default (`aria-hidden`), since it almost always sits next to the
 * visible "CareMetric CareBase" text and a name here would make screen readers
 * announce the brand twice. Pass `label` only when the mark stands alone and
 * needs its own accessible name.
 */
export function LogoMark({ className, label }: { className?: string; label?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo-mark.svg`}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

/**
 * The two-tone brand name. "CareMetric" inherits the surrounding text color
 * (set it to white on dark surfaces, brand blue on light ones); "CareBase"
 * uses the gray accent from the logo lockup.
 */
export function BrandName({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={className} style={style}>
      CareMetric <span style={{ color: BRAND_GRAY }}>CareBase</span>
    </span>
  );
}
