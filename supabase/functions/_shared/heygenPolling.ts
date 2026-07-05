import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

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
 * Polls HeyGen for the current status of a single course_block's in-flight video job and, when
 * complete, downloads the video from HeyGen's expiring URL and re-uploads it into the
 * course-videos storage bucket. Writes the resolved state back onto the block via `writeClient`
 * (the caller's RLS-scoped client, so a non-owning caller can't overwrite a block it doesn't have
 * write access to). Storage upload uses `storageClient`, which must be a service-role client --
 * the storage bucket write is a system operation and does not depend on which caller triggered it.
 *
 * `writeClient` and `storageClient` may be the same client (e.g. a service-role client, as used
 * by the cron-invoked poll-heygen-video-statuses function, which has no caller JWT at all).
 */
export async function pollAndResolveHeygenVideo(
  writeClient: SupabaseClient,
  storageClient: SupabaseClient,
  block: HeygenPollableBlock,
  heygenApiKey: string,
): Promise<HeygenPollResult> {
  const job = block.body?.heygen;
  if (!job?.video_id) {
    return { status: "no_job", error: "no pending video generation for this block" };
  }

  if (job.status === "completed") {
    return { status: "completed" };
  }

  const statusRes = await fetch(`https://api.heygen.com/v3/videos/${job.video_id}`, {
    headers: { "x-api-key": heygenApiKey },
  });
  const statusBody = await statusRes.json().catch(() => null);
  if (!statusRes.ok || !statusBody?.data) {
    return { status: "error", error: statusBody?.message ?? "failed to check HeyGen video status" };
  }

  const heygenStatus = statusBody.data.status as string;

  if (heygenStatus === "failed") {
    const failureMessage = statusBody.data.failure_message ?? "video generation failed";
    await writeClient
      .from("course_blocks")
      // Copilot review finding: `body: { heygen: ... }` alone replaces the entire jsonb column,
      // silently dropping body.script (AI narration) and any other sibling key. Spread the
      // existing body first so only the `heygen` key actually changes.
      .update({ body: { ...block.body, heygen: { ...job, status: "failed", error: failureMessage } } })
      .eq("id", block.id);
    return { status: "failed", error: failureMessage };
  }

  if (heygenStatus !== "completed") {
    await writeClient
      .from("course_blocks")
      .update({ body: { ...block.body, heygen: { ...job, status: heygenStatus } } })
      .eq("id", block.id);
    return { status: heygenStatus };
  }

  const videoRes = await fetch(statusBody.data.video_url);
  if (!videoRes.ok || !videoRes.body) {
    return { status: "error", error: "failed to download completed video from HeyGen" };
  }
  const videoBytes = new Uint8Array(await videoRes.arrayBuffer());

  const storagePath = `${block.organization_id ?? "system"}/${block.id}.mp4`;
  const { error: uploadError } = await storageClient.storage.from("course-videos").upload(storagePath, videoBytes, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (uploadError) return { status: "error", error: uploadError.message };

  const { data: publicUrlData } = storageClient.storage.from("course-videos").getPublicUrl(storagePath);

  const { error: updateError } = await writeClient
    .from("course_blocks")
    .update({
      video_url: publicUrlData.publicUrl,
      body: { ...block.body, heygen: { ...job, status: "completed", completed_at: new Date().toISOString() } },
    })
    .eq("id", block.id);
  if (updateError) return { status: "error", error: updateError.message };

  return { status: "completed", video_url: publicUrlData.publicUrl };
}
