import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One-line purpose strip so overlapping "centers" (Today / Dashboard / Command Center /
 * Survey Day / Value Center / Closed-loop) stay disambiguated without extra docs.
 */
export function SurfacePurpose({
  purpose,
  className,
}: {
  purpose: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground",
        className,
      )}
      role="note"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <p className="leading-snug">{purpose}</p>
    </div>
  );
}
