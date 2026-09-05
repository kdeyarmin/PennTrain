import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Lock } from "lucide-react";
import { EMPTY_VIDEO_STATE, type VideoBlockState } from "@/lib/videoWatchState";
import { useCourseVideoUrl } from "@/hooks/useCourseVideoUrl";

// "Watched through" tolerates outros/rounding: 95% of duration or the ended event.
const WATCHED_FRACTION = 0.95;
// How far past the high-water mark a gated seek may land before being snapped back.
const SEEK_TOLERANCE_SECONDS = 2;
// How often to report state while playing (parent persists on its own debounce).
const REPORT_INTERVAL_MS = 10_000;
// Re-signs allowed per load. An expired signature recovers on the first; a deleted object or a
// revoked storage policy fails the same way every time, and telling the learner beats a loop.
const MAX_RESIGN_ATTEMPTS = 2;

function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.round(total));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

interface CourseVideoPlayerProps {
  src: string;
  /** Persisted state for this block; undefined for a first watch. */
  state: VideoBlockState | undefined;
  /**
   * When true, forward seeking is clamped to the high-water mark until the video has
   * been watched through. Resume + completion tracking happen regardless, so turning
   * the gate on later credits earlier full watches.
   */
  gated: boolean;
  /** Called with fresh state on pause/ended/completion and every few seconds while playing. */
  onChange: (next: VideoBlockState) => void;
}

/**
 * Tracked course video player: resumes at the saved position, records a furthest-watched
 * high-water mark, and (when gated) prevents skipping ahead of it -- the client half of
 * the compliance watch gate. Server-side completion integrity still rests on
 * complete_course_assignment(); this keeps honest employees honest and their place saved.
 */
export function CourseVideoPlayer({ src, state, gated, onChange }: CourseVideoPlayerProps) {
  const resolved = useCourseVideoUrl(src);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stateRef = useRef<VideoBlockState>({ ...(state ?? EMPTY_VIDEO_STATE) });
  const restoredRef = useRef(false);
  const [completed, setCompleted] = useState(!!state?.completedAt);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  // A signed course-video URL lasts 15 minutes and a lesson can be longer, so a learner watching
  // straight through -- or coming back from a pause -- hits an expired signature partway. The
  // browser reports that as a media error and nothing was listening: the video simply stopped,
  // with no message and no way forward but a reload, which lost the place. One silent re-sign per
  // error, capped so a genuinely missing object does not spin.
  const resignAttemptsRef = useRef(0);
  const [resigning, setResigning] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Remount-per-src is handled by the parent keying this component on the block id, so
  // refs here always describe exactly one video.
  useEffect(() => {
    stateRef.current = { ...(state ?? EMPTY_VIDEO_STATE) };
    setCompleted(!!state?.completedAt);
    restoredRef.current = false;
    resignAttemptsRef.current = 0;
    setPlaybackError(null);
    // Intentionally only on src change: `state` also updates as we report our own
    // changes upward, and re-syncing from those echoes would fight the playhead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // A re-signed URL is the same video at the same place. Clearing the one-shot restore guard is
  // what lets loadedmetadata put the playhead back instead of starting the lesson over.
  useEffect(() => {
    restoredRef.current = false;
  }, [resolved.url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const report = () => onChange({ ...stateRef.current });

    const markCompleted = () => {
      if (stateRef.current.completedAt) return;
      stateRef.current.completedAt = new Date().toISOString();
      setCompleted(true);
      report();
    };

    const handleLoadedMetadata = () => {
      if (restoredRef.current) return;
      restoredRef.current = true;
      const resumeAt = stateRef.current.position;
      if (resumeAt > 1 && Number.isFinite(video.duration) && resumeAt < video.duration - 1) {
        video.currentTime = resumeAt;
      }
      if (Number.isFinite(video.duration)) {
        setRemainingSeconds(Math.max(0, video.duration - stateRef.current.maxWatched));
      }
    };

    const handleTimeUpdate = () => {
      // seeking is handled separately; only organic playback raises the high-water mark.
      if (video.seeking) return;
      stateRef.current.position = video.currentTime;
      if (video.currentTime > stateRef.current.maxWatched) {
        stateRef.current.maxWatched = video.currentTime;
      }
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setRemainingSeconds(Math.max(0, video.duration - stateRef.current.maxWatched));
        if (stateRef.current.maxWatched >= video.duration * WATCHED_FRACTION) {
          markCompleted();
        }
      }
    };

    const handleSeeking = () => {
      if (!gated || stateRef.current.completedAt) return;
      const limit = stateRef.current.maxWatched + SEEK_TOLERANCE_SECONDS;
      if (video.currentTime > limit) {
        video.currentTime = stateRef.current.maxWatched;
      }
    };

    const handlePause = () => {
      stateRef.current.position = video.currentTime;
      report();
    };

    const handleEnded = () => {
      stateRef.current.position = 0; // a finished video resumes from the top on rewatch
      if (Number.isFinite(video.duration)) stateRef.current.maxWatched = video.duration;
      markCompleted();
      report();
    };

    const handleError = () => {
      // The playhead is the thing worth saving: `position` is where the restore above resumes
      // from, and video.currentTime is still readable on the errored element.
      if (Number.isFinite(video.currentTime) && video.currentTime > stateRef.current.position) {
        stateRef.current.position = video.currentTime;
      }
      report();
      if (resignAttemptsRef.current >= MAX_RESIGN_ATTEMPTS) {
        setResigning(false);
        setPlaybackError("This video stopped loading. Reload the page to try again.");
        return;
      }
      resignAttemptsRef.current += 1;
      setResigning(true);
      setPlaybackError(null);
      resolved.refresh();
    };

    const handleLoadedData = () => {
      // A frame decoded means the new signature works; the counter resets so a later expiry in
      // the same sitting gets its own attempts.
      resignAttemptsRef.current = 0;
      setResigning(false);
      setPlaybackError(null);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("seeking", handleSeeking);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);
    video.addEventListener("loadeddata", handleLoadedData);
    const interval = window.setInterval(() => {
      if (!video.paused && !video.ended) report();
    }, REPORT_INTERVAL_MS);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("seeking", handleSeeking);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      video.removeEventListener("loadeddata", handleLoadedData);
      window.clearInterval(interval);
    };
    // resolved.refresh is useCallback-stable over the query's refetch; taking the whole `resolved`
    // object here would re-attach every listener on every render.
  }, [gated, onChange, resolved.url, resolved.refresh, src]);

  return (
    <div className="space-y-2">
      {resolved.isLoading && <div className="aspect-video w-full animate-pulse rounded-lg bg-muted" />}
      {resolved.error && <p className="text-sm text-destructive">Video unavailable: {resolved.error}</p>}
      {resigning && <p className="text-xs text-muted-foreground">Refreshing the video link -- your place is saved.</p>}
      {playbackError && <p className="text-sm text-destructive">{playbackError}</p>}
      {resolved.url && <video ref={videoRef} controls className="w-full rounded-lg border" src={resolved.url}>
        Your browser does not support embedded video.
      </video>}
      {gated && (
        completed ? (
          <p className="flex items-center gap-1.5 text-xs text-green-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> Video watched -- you can continue.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Watch the full video to continue
            {remainingSeconds !== null && remainingSeconds > 0 && (
              <> -- about {formatSeconds(remainingSeconds)} remaining</>
            )}
            . You can rewind, but not skip ahead.
          </p>
        )
      )}
    </div>
  );
}
