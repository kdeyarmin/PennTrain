// @ts-nocheck
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.48.1";

// This repo's first _shared/ module -- kept intentionally minimal (one function, no framework)
// since there's no existing sharing precedent to follow here. Extracted verbatim from
// check-course-video-status/index.ts so both that caller-invoked endpoint and the cron-invoked
// poll-heygen-video-statuses endpoint stay in lockstep on HeyGen's polling/re-hosting contract.

export interface HeygenJobState {
  video_id: string;
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
  // Deliberately not narrowed to `{ heygen?: HeygenJobState }` -- video blocks also store AI
  // narration under body.script, and every write below must preserve that (and any other
  // sibling key) rather than replacing the whole jsonb column with just `heygen`.
  body: (Record<string, unknown> & { heygen?: HeygenJobState }) | null;
}

export interface HeygenPollResult {
  status: string;
  video_url?: string;
  error?: string;
}

/**
 * Generous upper bound on how long a HeyGen render may stay in-flight before the cron poller
 * gives up on it. A deleted/expired video_id makes the status fetch error on every poll, and an
 * errored poll (by design) writes nothing -- so without a cutoff the block is re-selected forever
 * and the UI stays stuck on "processing". Real renders finish in minutes; 24 hours is far past
 * any legitimate render window.
 */
export const HEYGEN_MAX_RENDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Error note written onto a job that exceeded HEYGEN_MAX_RENDER_WINDOW_MS. */
export const HEYGEN_AGED_OUT_ERROR = "video generation timed out";

// Single write seam shared by pollAndResolveHeygenVideo and failAgedOutHeygenJob -- see
// pollAndResolveHeygenVideo's doc comment for why `usePrivilegedRpc` routes through
// write_course_block_heygen_state() instead of a bare `.update()`.
function writeHeygenBlockState(
  writeClient: SupabaseClient,
  blockId: string,
  updates: { body: Record<string, unknown>; video_url?: string },
  usePrivilegedRpc: boolean,
) {
  return usePrivilegedRpc
    ? writeClient.rpc("write_course_block_heygen_state", {
      p_block_id: blockId,
      p_body: updates.body,
      p_video_url: updates.video_url ?? null,
    })
    : writeClient.from("course_blocks").update(updates).eq("id", blockId);
}

/**
 * True when the block's in-flight HeyGen job is older than HEYGEN_MAX_RENDER_WINDOW_MS, dated by
 * heygen.requested_at (stamped by generate-course-video when the job is created). Legacy rows
 * without a parseable requested_at have no other timestamp to age by -- the heygen object stores
 * nothing else until completion -- so they are deliberately never aged out here rather than
 * mass-failing rows that cannot be dated.
 */
export function isHeygenJobAgedOut(
  job: HeygenJobState | undefined,
  nowMs: number = Date.now(),
): boolean {
  const requestedAtMs = typeof job?.requested_at === "string"
    ? Date.parse(job.requested_at)
    : NaN;
  if (!Number.isFinite(requestedAtMs)) return false;
  return nowMs - requestedAtMs > HEYGEN_MAX_RENDER_WINDOW_MS;
}

/**
 * Writes the terminal aged-out state ("failed" + HEYGEN_AGED_OUT_ERROR) for a job the poller
 * could not resolve within the render window, preserving sibling body keys (body.script etc.)
 * exactly like every other write in this module. Callers decide WHEN to age out (poll first, so
 * a job that genuinely finished can still resolve); this only performs the write. Never marks
 * completed -- an aged-out job is only ever failed.
 */
export async function failAgedOutHeygenJob(
  writeClient: SupabaseClient,
  block: HeygenPollableBlock,
  usePrivilegedRpc = false,
): Promise<HeygenPollResult> {
  const job = block.body?.heygen;
  if (!job?.video_id) {
    return {
      status: "no_job",
      error: "no pending video generation for this block",
    };
  }
  const { error: writeError } = await writeHeygenBlockState(
    writeClient,
    block.id,
    {
      body: {
        ...block.body,
        heygen: { ...job, status: "failed", error: HEYGEN_AGED_OUT_ERROR },
      },
    },
    usePrivilegedRpc,
  );
  if (writeError) return { status: "error", error: writeError.message };
  return { status: "failed", error: HEYGEN_AGED_OUT_ERROR };
}

/**
 * Polls HeyGen for the current status of a single course_block's in-flight video job and, when
 * complete, downloads the video from HeyGen's expiring URL and re-uploads it into the
 * course-videos storage bucket. Writes the resolved state back onto the block via `writeClient`
 * (the caller's RLS-scoped client, so a non-owning caller can't overwrite a block it doesn't have
 * write access to). Storage upload uses `storageClient`, which must be a service-role client --
 * the storage bucket write is a system operation and does not depend on which caller triggered it.
 *
 * `writeClient` and `storageClient` may be the same client (e.g. a service-role client, as used
 * by the cron-invoked poll-heygen-video-statuses function, which has no caller JWT at all).
 *
 * `usePrivilegedRpc` must be true whenever `writeClient` is a service-role client with no caller
 * JWT (poll-heygen-video-statuses): lock_published_course_block()'s only other bypass,
 * is_platform_admin(), needs auth.uid() and can never be true for that client, and a bare
 * `.update()` runs as its own PostgREST transaction, so a separate prior set_config() call
 * wouldn't be visible to it anyway. Routes the write through write_course_block_heygen_state()
 * (20260706101500_write_course_block_heygen_state_rpc.sql) instead, which sets the transaction-local
 * app.privileged_write GUC and performs the update in the same statement. check-course-video-status
 * (authenticated platform_admin caller) leaves this false -- its direct `.update()` already
 * satisfies the is_platform_admin() bypass today.
 */
export async function pollAndResolveHeygenVideo(
  writeClient: SupabaseClient,
  storageClient: SupabaseClient,
  block: HeygenPollableBlock,
  heygenApiKey: string,
  usePrivilegedRpc = false,
): Promise<HeygenPollResult> {
  const job = block.body?.heygen;
  if (!job?.video_id) {
    return {
      status: "no_job",
      error: "no pending video generation for this block",
    };
  }

  if (job.status === "completed") {
    return { status: "completed" };
  }

  const writeCourseBlock = (
    updates: { body: Record<string, unknown>; video_url?: string },
  ) => writeHeygenBlockState(writeClient, block.id, updates, usePrivilegedRpc);

  const statusRes = await fetch(
    `https://api.heygen.com/v3/videos/${job.video_id}`,
    {
      headers: { "x-api-key": heygenApiKey },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const statusBody = await statusRes.json().catch(() => null);
  if (!statusRes.ok || !statusBody?.data) {
    return {
      status: "error",
      error: statusBody?.message ?? "failed to check HeyGen video status",
    };
  }

  const heygenStatus = statusBody.data.status as string;

  if (heygenStatus === "failed") {
    const failureMessage = statusBody.data.failure_message ??
      "video generation failed";
    // Copilot review finding: `body: { heygen: ... }` alone replaces the entire jsonb column,
    // silently dropping body.script (AI narration) and any other sibling key. Spread the
    // existing body first so only the `heygen` key actually changes.
    const { error: writeError } = await writeCourseBlock({
      body: {
        ...block.body,
        heygen: { ...job, status: "failed", error: failureMessage },
      },
    });
    // Copilot review finding: a failed write here was silently ignored, so the DB row could be
    // left unchanged (still showing the prior in-flight status) while this call reports "failed" --
    // the cron poller would then keep re-polling HeyGen for a job that's already known to have
    // failed, instead of surfacing the write error itself.
    if (writeError) return { status: "error", error: writeError.message };
    return { status: "failed", error: failureMessage };
  }

  if (heygenStatus !== "completed") {
    const { error: writeError } = await writeCourseBlock({
      body: { ...block.body, heygen: { ...job, status: heygenStatus } },
    });
    if (writeError) return { status: "error", error: writeError.message };
    return { status: heygenStatus };
  }

  const videoRes = await fetch(statusBody.data.video_url, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!videoRes.ok || !videoRes.body) {
    return {
      status: "error",
      error: "failed to download completed video from HeyGen",
    };
  }

  const storagePath = `${block.organization_id ?? "system"}/${block.id}.mp4`;
  // Stream the provider download straight into Storage instead of buffering the
  // whole video in memory first (a long avatar video easily exceeds an edge
  // function's memory budget). storage-js 2.7.1 (via the pinned
  // supabase-js@2.48.1) accepts a ReadableStream<Uint8Array> body and forwards
  // the `duplex` option to fetch, which streaming request bodies require. The
  // 60s AbortSignal above still bounds the total transfer, same as before.
  const { error: uploadError } = await storageClient.storage.from(
    "course-videos",
  ).upload(storagePath, videoRes.body, {
    contentType: "video/mp4",
    upsert: true,
    duplex: "half",
  });
  if (uploadError) return { status: "error", error: uploadError.message };

  // Persist a bucket locator, never a public URL. The authenticated frontend
  // exchanges this locator for a short-lived signed URL after RLS authorizes it.
  const videoLocator = `storage://course-videos/${storagePath}`;

  const { error: updateError } = await writeCourseBlock({
    video_url: videoLocator,
    body: {
      ...block.body,
      heygen: {
        ...job,
        status: "completed",
        completed_at: new Date().toISOString(),
      },
    },
  });
  if (updateError) return { status: "error", error: updateError.message };

  return { status: "completed", video_url: videoLocator };
}
