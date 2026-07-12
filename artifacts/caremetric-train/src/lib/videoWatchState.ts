export interface VideoBlockState {
  /** Last playback position in seconds, for cross-session resume. */
  position: number;
  /** Furthest point ever reached, in seconds -- the no-skip high-water mark. */
  maxWatched: number;
  /** Set once the video has been watched through. */
  completedAt: string | null;
}

export const EMPTY_VIDEO_STATE: VideoBlockState = { position: 0, maxWatched: 0, completedAt: null };

/**
 * Defensive parse of course_progress.video_state (a learner-writable jsonb column):
 * anything malformed degrades to "not watched yet" rather than crashing the player or
 * unlocking the gate.
 */
export function sanitizeVideoState(raw: unknown): Record<string, VideoBlockState> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, VideoBlockState> = {};
  for (const [blockId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Partial<VideoBlockState>;
    const position = typeof entry.position === "number" && Number.isFinite(entry.position) && entry.position >= 0
      ? entry.position : 0;
    const maxWatched = typeof entry.maxWatched === "number" && Number.isFinite(entry.maxWatched) && entry.maxWatched >= 0
      ? entry.maxWatched : 0;
    out[blockId] = {
      position,
      maxWatched: Math.max(position, maxWatched),
      completedAt: typeof entry.completedAt === "string" ? entry.completedAt : null,
    };
  }
  return out;
}
