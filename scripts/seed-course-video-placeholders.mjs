import { readFile } from "node:fs/promises";

// Uploads a tiny placeholder MP4 to the `course-videos` Storage bucket for the 3 HeyGen-narrated
// New Employee Orientation blocks (20260724040747_add_new_employee_orientation_course_pch_alf.sql).
// Those blocks' real video files exist only in the production Supabase project -- see that
// migration's own comment -- so every other environment (CI, local dev, preview branches, forks)
// resolves them to a missing Storage object today. With `learning.video_watch_gate` now globally
// enabled (20260802030000_remove_pilot_program.sql), that missing object permanently locks the
// block instead of just degrading gracefully. See BACKLOG.md SG-3.
//
// This does not touch the compliance gate's logic at all -- it fixes the missing asset, not the
// gate. The 3 block IDs are stable (defined at migration time, not derived from seed data), so
// this is independent of whether seed.sql runs -- it works the same with `db reset --no-seed`.
//
// SAFETY: this must never be able to touch a real project. The guard below is not a policy note,
// it is an exit(1) before any network call if SUPABASE_URL is not a loopback address. There is
// deliberately no override flag.

const BUCKET = "course-videos";
const BLOCK_IDS = [
  "a37ce65f-b5e0-4ddd-9181-92c32d57c20f", // block 2
  "d8424426-4992-4d3a-aa53-b8017480a30f", // block 5
  "0787360c-785c-4f20-9163-e5a9fc9d1be7", // block 8
];
const PLACEHOLDER_PATH = "artifacts/caremetric-carebase/e2e/fixtures/course-videos/placeholder.mp4";

function assertLocalOnly(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`SUPABASE_URL is not a valid URL: ${rawUrl}`);
  }
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "0.0.0.0";
  if (!isLoopback) {
    throw new Error(
      `Refusing to run: SUPABASE_URL (${url.hostname}) is not a loopback address. ` +
        "This script only ever seeds a local/CI Supabase instance -- there is no override for a non-loopback host.",
    );
  }
  return url;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set (see `supabase status -o env`).");
  }
  assertLocalOnly(supabaseUrl);

  const body = await readFile(PLACEHOLDER_PATH);

  for (const blockId of BLOCK_IDS) {
    const objectPath = `system/${blockId}.mp4`;
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "video/mp4",
        "x-upsert": "true",
      },
      body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Upload failed for ${objectPath}: HTTP ${response.status} ${detail}`);
    }
    process.stdout.write(`OK  ${BUCKET}/${objectPath}\n`);
  }

  process.stdout.write(`Seeded ${BLOCK_IDS.length} course-video placeholder(s) into ${new URL(supabaseUrl).host}.\n`);
}

main().catch((error) => {
  process.stderr.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
