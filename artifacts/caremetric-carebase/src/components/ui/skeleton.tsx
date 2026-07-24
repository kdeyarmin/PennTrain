import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-md bg-muted", className)}
      {...props}
    >
      {/* A single soft light sweep reads more "loading" than a flat pulse, and respects
          prefers-reduced-motion (the sweep is paused, the muted base still signals a placeholder). */}
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent motion-safe:animate-[skeleton-shimmer_1.6s_infinite] motion-reduce:hidden" />
    </div>
  )
}

export { Skeleton }
