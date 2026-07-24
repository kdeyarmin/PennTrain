import { type ReactNode } from "react";
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
import type { MarketingVideo } from "./marketingVideos";

/**
 * Branded modal player for a marketing video. Wrap any trigger element as
 * children; Radix unmounts the content on close, which stops playback for free.
 */
export function VideoModal({ video, children }: { video: MarketingVideo; children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-[min(92vw,880px)] max-w-none gap-0 overflow-hidden border-white/10 bg-[#071626] p-0 text-white shadow-[0_40px_90px_rgba(0,0,0,0.55)] sm:rounded-2xl">
        <div className="flex items-center gap-2.5 border-b border-white/10 bg-white/[0.04] px-5 py-3.5">
          <LogoMark className="h-6 w-6" />
          <DialogTitle className="text-sm font-bold text-white">{video.title}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">{video.title}</DialogDescription>
        <video
          className="aspect-video w-full bg-black"
          src={video.src}
          poster={video.poster}
          controls
          autoPlay
          playsInline
          preload="metadata"
          data-testid={`video-${video.key}`}
        >
          <track kind="captions" src={video.captions} srcLang="en" label="English" default />
          Your browser does not support embedded video.
        </video>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-white/[0.04] px-5 py-3.5">
          <p className="text-[13px] text-white/70">
            Plans from $239/month · 30-day free trial.
          </p>
          <DialogClose asChild>
            <Link
              href="/signup"
              className="inline-flex items-center rounded-md bg-white px-3.5 py-2 text-[13px] font-bold text-[#0d2742] transition-colors hover:bg-[#dcebfa]"
              data-testid={`link-${video.key}-signup`}
            >
              Start a Free Trial
            </Link>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A poster thumbnail with a play overlay that opens {@link VideoModal}. For
 * inline placement in a page section. Posters lazy-load so below-the-fold
 * thumbnails don't block first paint.
 */
export function VideoThumbnail({
  video,
  className,
  label,
  sublabel,
}: {
  video: MarketingVideo;
  className?: string;
  label?: string;
  sublabel?: string;
}) {
  return (
    <VideoModal video={video}>
      <button
        type="button"
        data-testid={`thumb-${video.key}`}
        aria-label={`Play video: ${video.title}`}
        className={cn(
          "group relative block w-full overflow-hidden rounded-xl border border-black/5 bg-[#0d2742] shadow-lg",
          className,
        )}
      >
        <img
          src={video.poster}
          alt=""
          loading="lazy"
          className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/15">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-xl transition-transform group-hover:scale-110">
            <Play className="h-6 w-6 translate-x-[1px] fill-[#0d2742] text-[#0d2742]" />
          </span>
        </span>
        {(label || sublabel) && (
          <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/75 to-transparent p-3 text-left">
            {label && <span className="text-sm font-bold text-white">{label}</span>}
            {sublabel && <span className="text-[11px] text-white/80">{sublabel}</span>}
          </span>
        )}
      </button>
    </VideoModal>
  );
}
