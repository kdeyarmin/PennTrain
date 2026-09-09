import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.48.1";

export interface HeygenJobState {
  video_id?: string;
  attempt_id?: string;
  status: string;
  avatar_id?: string;
  voice_id?: string;
  requested_at?: string;
  completed_at?: string;
  error?: string;
}

export interface HeygenPollableBlock {
  id: string;
  organization_id: string | null;
  course_version_id: string;
  block_type: string;
  title: string | null;
  video_url: string | null;
  body: (Record<string, unknown> & { heygen?: HeygenJobState }) | null;
}
export interface HeygenPollResult { status: string; video_url?: string; error?: string }
export const HEYGEN_MAX_RENDER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const HEYGEN_AGED_OUT_ERROR = "video generation timed out";

export function isHeygenJobAgedOut(job: HeygenJobState | undefined, nowMs = Date.now()): boolean {
  // No provider ID means submission itself is unresolved. Aging out that ambiguity as a failure
  // would allow a new paid attempt. Only the claim RPC may move it to reconciliation_required.
  if (!job?.video_id) return false;
  const requestedAt = typeof job.requested_at === "string" ? Date.parse(job.requested_at) : NaN;
  return Number.isFinite(requestedAt) && nowMs - requestedAt > HEYGEN_MAX_RENDER_WINDOW_MS;
}

async function resolveState(worker: SupabaseClient, block: HeygenPollableBlock,
  status: string, videoUrl?: string, failure?: string): Promise<HeygenPollResult> {
  const { heygen: job, ...body } = block.body ?? {};
  const { data, error } = await worker.rpc("resolve_course_video_generation", {
    p_block_id: block.id, p_video_id: job?.video_id, p_attempt_id: job?.attempt_id ?? null,
    p_expected_source: { version: block.course_version_id, type: block.block_type,
      organization_id: block.organization_id, title: block.title, body, video_url: block.video_url },
    p_status: status, p_video_url: videoUrl ?? null, p_error: failure ?? null,
  });
  if (error || !data) return { status: "error", error: "The current video status could not be saved. Please try again." };
  if (data.status === "stale") return { status: "stale", error: "Course content changed; this render was not attached." };
  return { status: data.status, ...(data.video_url ? { video_url: data.video_url } : {}),
    ...(data.status === "failed" ? { error: failure ?? "Video generation failed" } : {}) };
}

export async function failAgedOutHeygenJob(worker: SupabaseClient, block: HeygenPollableBlock): Promise<HeygenPollResult> {
  if (!block.body?.heygen?.video_id) return { status: block.body?.heygen?.status ?? "no_job" };
  return await resolveState(worker, block, "failed", undefined, HEYGEN_AGED_OUT_ERROR);
}

/** Both callers use the service-only CAS resolver after their own authorization checks.
 * A status poll can finish an already-started render after publication, but cannot mutate
 * arbitrary authoring content or replace a newer attempt. Each provider job has its own object.
 */
export async function pollAndResolveHeygenVideo(worker: SupabaseClient, block: HeygenPollableBlock,
  heygenApiKey: string, fetchImpl: typeof fetch = fetch): Promise<HeygenPollResult> {
  const job = block.body?.heygen;
  if (!job?.video_id) return job?.attempt_id ? { status: job.status } : { status: "no_job", error: "No pending video generation for this block" };
  if (job.status === "completed" || job.status === "failed") return { status: job.status, ...(block.video_url ? { video_url: block.video_url } : {}) };
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(job.video_id)) return { status: "error", error: "Invalid HeyGen video identifier" };
  try {
    const response = await fetchImpl(`https://api.heygen.com/v3/videos/${job.video_id}`, {
      headers: { "x-api-key": heygenApiKey }, signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.data) return { status: "error", error: "Unable to check HeyGen video status. Please try again." };
    const status = body.data.status;
    if (!["pending", "waiting", "queued", "processing", "completed", "failed"].includes(status)) {
      return { status: "error", error: "HeyGen returned an invalid video status" };
    }
    if (status === "failed") return await resolveState(worker, block, status, undefined, "HeyGen could not render this video.");
    if (status !== "completed") return await resolveState(worker, block, status);
    // Validate ownership/source before a large transfer. The final RPC repeats the same checks
    // because authoring can change while the bytes are uploading.
    const checked = await resolveState(worker, block, "processing");
    if (checked.status !== "processing") return checked;
    let download: URL;
    try {
      download = new URL(body.data.video_url);
      if (download.protocol !== "https:" || download.username || download.password) throw new Error("invalid url");
    } catch { return { status: "error", error: "HeyGen returned an invalid completed video URL" }; }
    const video = await fetchImpl(download.toString(), { signal: AbortSignal.timeout(60_000) });
    if (!video.ok || !video.body) return { status: "error", error: "Unable to download the completed HeyGen video" };
    // Preserve the block UUID before the first dot: the existing private Storage policy uses
    // that filename prefix to authorize course learners. A block/attempt subfolder would break it.
    const path = `${block.organization_id ?? "system"}/${block.id}.${job.video_id}.mp4`;
    const { error } = await worker.storage.from("course-videos").upload(path, video.body, {
      contentType: "video/mp4", upsert: false, duplex: "half",
    });
    // Two authorized polls may finish the same immutable job concurrently. Storage's Duplicate
    // response means the first poll already installed these same bytes; never overwrite them.
    const duplicate = error && ((error as { status?: number }).status === 409
      || String((error as { statusCode?: string }).statusCode) === "409"
      || (error as { error?: string }).error === "Duplicate");
    if (error && !duplicate) {
      return { status: "error", error: "Unable to store the completed course video. Please try again." };
    }
    return await resolveState(worker, block, "completed", `storage://course-videos/${path}`);
  } catch { return { status: "error", error: "HeyGen video status could not be checked. Please try again." }; }
}
