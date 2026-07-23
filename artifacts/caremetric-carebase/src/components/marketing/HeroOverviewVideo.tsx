import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { MARKETING_VIDEOS } from "./marketingVideos";
import { VideoModal } from "./VideoModal";

/**
 * "Watch the overview" affordance for the landing hero — the play pill that
 * opens the landing overview video in the shared branded modal. Lazy-loaded by
 * Landing so the modal's Dialog dependency stays out of the eager route bundle.
 */
export function HeroOverviewVideo({ className }: { className?: string }) {
  return (
    <VideoModal video={MARKETING_VIDEOS.landingOverview}>
      <button
        type="button"
        data-testid="button-hero-watch-overview"
        className={cn(
          "group inline-flex items-center gap-3 text-[15px] font-semibold text-white/85 transition-colors hover:text-white",
          className,
        )}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-white/10 shadow-[0_0_0_5px_rgba(142,200,255,0.12)] transition-colors group-hover:border-white/40 group-hover:bg-white/20">
          <Play className="h-4 w-4 translate-x-[1px] fill-current text-white" />
        </span>
        <span className="text-left">
          Watch the overview
          <span className="block text-[12.5px] font-medium text-white/60">90-second product tour</span>
        </span>
      </button>
    </VideoModal>
  );
}
