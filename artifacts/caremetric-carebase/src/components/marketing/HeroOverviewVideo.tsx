import { Link } from "wouter";
import { Play } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LogoMark } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import { LANDING_VIDEO } from "./landingVideo";

/**
 * "Watch the overview" affordance for the landing hero.
 *
 * Opens a branded modal that plays the HeyGen-generated marketing video (an
 * AI-avatar presenter narrating the CareBase overview). Renders nothing until a
 * video source is configured via VITE_LANDING_VIDEO_URL (see ./landingVideo.ts),
 * so the hero falls back to its animated dashboard mockup with no broken control.
 *
 * The video element lives inside the Dialog content, which Radix unmounts on
 * close — so closing the modal stops playback for free.
 */
export function HeroOverviewVideo({ className }: { className?: string }) {
  if (!LANDING_VIDEO.enabled) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
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
      </DialogTrigger>

      <DialogContent className="w-[min(92vw,880px)] max-w-none gap-0 overflow-hidden border-white/10 bg-[#071626] p-0 text-white shadow-[0_40px_90px_rgba(0,0,0,0.55)] sm:rounded-2xl">
        <div className="flex items-center gap-2.5 border-b border-white/10 bg-white/[0.04] px-5 py-3.5">
          <LogoMark className="h-6 w-6" />
          <DialogTitle className="text-sm font-bold text-white">
            CareMetric CareBase — Overview
          </DialogTitle>
        </div>

        <DialogDescription className="sr-only">
          A short overview of how CareMetric CareBase keeps Pennsylvania personal care homes and
          assisted living facilities survey-ready.
        </DialogDescription>

        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- caption track is provided below */}
        <video
          className="aspect-video w-full bg-black"
          src={LANDING_VIDEO.src}
          poster={LANDING_VIDEO.poster}
          controls
          autoPlay
          playsInline
          preload="metadata"
          data-testid="video-hero-overview"
        >
          <track
            kind="captions"
            src={LANDING_VIDEO.captions}
            srcLang="en"
            label="English"
            default
          />
          Your browser does not support embedded video.
        </video>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-white/[0.04] px-5 py-3.5">
          <p className="text-[13px] text-white/70">
            Priced per facility · every module included · 30-day free trial.
          </p>
          <DialogClose asChild>
            <Link
              href="/signup"
              className="inline-flex items-center rounded-md bg-white px-3.5 py-2 text-[13px] font-bold text-[#0d2742] transition-colors hover:bg-[#dcebfa]"
              data-testid="link-overview-signup"
            >
              Start a Free Trial
            </Link>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
