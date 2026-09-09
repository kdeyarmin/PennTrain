import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { selectPollableHeygenBlocks } from "./query.ts";

Deno.test("unconfirmed attempts cannot fill the cron batch ahead of pollable provider jobs", async () => {
  const rows = [
    ...Array.from({ length: 60 }, (_, id) => ({ id: `unconfirmed-${id}`, block_type: "video",
      body: { heygen: { status: id % 2 ? "unknown" : "submitting", attempt_id: `attempt-${id}`, video_id: id % 3 ? null : "" } } })),
    { id: "ready", block_type: "video", body: { heygen: { status: "processing", video_id: "provider-ready" } } },
    { id: "legacy", block_type: "video", body: { heygen: { status: "waiting", video_id: "provider-legacy" } } },
    { id: "terminal", block_type: "video", body: { heygen: { status: "completed", video_id: "provider-done" } } },
  ];
  const client = createClient("https://project.test", "anon-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input) => {
      // Drive the production helper through the real pinned PostgREST query builder. The
      // fixture deliberately places more than a full batch of unpollable attempts first.
      const url = new URL(String(input));
      const query = url.searchParams;
      assertEquals(url.pathname, "/rest/v1/course_blocks");
      assertEquals(query.get("block_type"), "eq.video");
      assertEquals(query.get("body->heygen->>status"), "not.in.(completed,failed)");
      assertEquals(query.getAll("body->heygen->>video_id"), ["not.is.null", "neq."]);
      assertEquals(query.get("limit"), "50");
      // PostgREST applies predicates before LIMIT. Removing either provider-ID predicate
      // above reproduces the original starvation even though the poller later ignores it.
      const selected = rows.filter(row => row.block_type === "video"
        && !["completed", "failed"].includes(row.body.heygen.status)
        && row.body.heygen.video_id != null && row.body.heygen.video_id !== "")
        .slice(0, Number(query.get("limit")));
      return Promise.resolve(new Response(JSON.stringify(selected), { headers: { "Content-Type": "application/json" } }));
    } },
  });
  const { data, error } = await selectPollableHeygenBlocks(client, 50);
  assertEquals(error, null);
  assertEquals(data?.map(row => row.id), ["ready", "legacy"]);
  assertEquals(rows.filter(row => row.id.startsWith("unconfirmed-")).length, 60);
});
