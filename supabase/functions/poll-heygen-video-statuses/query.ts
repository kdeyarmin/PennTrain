import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.48.1";

/** Apply worker eligibility in Postgres before the batch limit. Submission-only attempts
 * cannot be polled yet and must not consume every slot ahead of provider-backed renders.
 * They remain durable and can still be retried/reconciled through the generation claim RPC.
 */
export function selectPollableHeygenBlocks(client: SupabaseClient, batchSize: number) {
  return client.from("course_blocks")
    .select("id, organization_id, course_version_id, block_type, title, body, video_url")
    .eq("block_type", "video")
    .not("body->heygen->>status", "in", "(completed,failed)")
    .not("body->heygen->>video_id", "is", null)
    .neq("body->heygen->>video_id", "")
    .limit(batchSize);
}
