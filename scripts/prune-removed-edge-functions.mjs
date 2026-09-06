#!/usr/bin/env node
/**
 * Delete edge functions from the remote Supabase project after their source is deleted here.
 *
 * `supabase functions deploy` only pushes what exists under supabase/functions. It has no notion
 * of a function that used to exist, so removing the directory in a PR leaves the function ACTIVE
 * on production -- still routable, still holding its deployed secrets -- and then
 * check-edge-function-drift.mjs fails the deploy with `ORPHAN (remote not local)`. That failure
 * lands after `supabase db push` has already run, i.e. a half-applied deploy whose live function
 * calls schema the migration just dropped.
 *
 * This closes the gap: every slug in scripts/removed-edge-functions.json is DELETEd through the
 * Management API immediately before the presence check. Deletion is idempotent -- a slug already
 * gone returns 404, which counts as success -- so the manifest entry stays true on every later
 * deploy and doubles as the record of what was removed and by which migration.
 *
 * Deliberately narrow: it deletes ONLY slugs named in the manifest, never everything remote-but-
 * not-local. An unexpected orphan is a fact for a human to look at, and the drift check still
 * fails on it.
 *
 * AND DELETION IS OPT-IN. Without --apply this reports what it would delete and changes nothing,
 * because the alternative was learned the hard way: the first version deleted whenever a
 * SUPABASE_ACCESS_TOKEN happened to be in the environment, so running it once to validate the
 * manifest removed a live production function before its migration had been merged. A destructive
 * default is wrong for something a person will run locally to see what it does. CI passes --apply.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { listLocalFunctionSlugs } from "./check-edge-function-drift.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = join(ROOT, "scripts", "removed-edge-functions.json");
const API_BASE = process.env.SUPABASE_API_URL ?? "https://api.supabase.com";

export function readRemovedSlugs(manifestPath = MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return Object.keys(manifest)
    .filter((key) => !key.startsWith("_"))
    .sort();
}

/**
 * A slug listed as removed must not exist under supabase/functions -- the manifest and the tree
 * would be claiming opposite things about whether it is live. That is a `conflict`, and the
 * caller fails on it rather than deleting a function someone still deploys on purpose.
 */
export function planPrune(removedSlugs, localSlugs, remoteSlugs) {
  const local = new Set(localSlugs);
  const remote = new Set(remoteSlugs);
  const conflicts = removedSlugs.filter((slug) => local.has(slug)).sort();
  const deletable = removedSlugs.filter((slug) => !local.has(slug));
  return {
    conflicts,
    toDelete: deletable.filter((slug) => remote.has(slug)).sort(),
    alreadyGone: deletable.filter((slug) => !remote.has(slug)).sort(),
  };
}

async function fetchRemoteSlugs(projectRef, token) {
  const res = await fetch(`${API_BASE}/v1/projects/${projectRef}/functions`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Management API list functions failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("Unexpected functions list payload");
  return body.map((fn) => fn.slug ?? fn.name).filter(Boolean);
}

async function deleteRemoteFunction(projectRef, token, slug) {
  const res = await fetch(
    `${API_BASE}/v1/projects/${projectRef}/functions/${encodeURIComponent(slug)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  // 404 is success: the function is gone, which is the whole point of the call.
  if (res.ok || res.status === 404) return res.status;
  throw new Error(`Management API delete ${slug} failed: HTTP ${res.status}`);
}

function projectRefFromEnvOrConfig() {
  if (process.env.SUPABASE_PROJECT_ID) return process.env.SUPABASE_PROJECT_ID;
  const configPath = join(ROOT, "supabase", "config.toml");
  if (!existsSync(configPath)) return null;
  const match = readFileSync(configPath, "utf8").match(/project_id\s*=\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

function selfTest() {
  const plan = planPrune(["gone", "never-deployed", "still-here"], ["still-here"], ["gone", "live"]);
  if (plan.toDelete.join(",") !== "gone") throw new Error("planPrune toDelete self-test failed");
  if (plan.alreadyGone.join(",") !== "never-deployed") {
    throw new Error("planPrune alreadyGone self-test failed");
  }
  if (plan.conflicts.join(",") !== "still-here") {
    throw new Error("planPrune conflicts self-test failed");
  }
  // A live function that is not in the manifest is never touched by this script.
  if (plan.toDelete.includes("live")) throw new Error("planPrune must not delete unlisted slugs");

  const slugs = readRemovedSlugs();
  if (!Array.isArray(slugs)) throw new Error("readRemovedSlugs self-test failed");
  if (slugs.some((slug) => slug.startsWith("_"))) {
    throw new Error("readRemovedSlugs must skip _readme-style keys");
  }
  const overlap = planPrune(slugs, listLocalFunctionSlugs(), []).conflicts;
  if (overlap.length) {
    throw new Error(
      `scripts/removed-edge-functions.json lists ${overlap.join(", ")}, which still exists under supabase/functions`,
    );
  }
  console.log(`Removed-edge-function prune self-test passed (${slugs.length} recorded removals).`);
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  // Report-only unless --apply. See the header: the default must never mutate production.
  const apply = process.argv.includes("--apply");

  const removed = readRemovedSlugs();
  if (!removed.length) {
    console.log("No removed edge functions recorded — nothing to prune.");
    return;
  }

  const local = listLocalFunctionSlugs();
  const conflicting = removed.filter((slug) => local.includes(slug));
  if (conflicting.length) {
    console.error(
      `scripts/removed-edge-functions.json lists ${conflicting.join(", ")}, but supabase/functions still contains it.`,
    );
    console.error("Remove the manifest entry or the directory — they cannot both be right.");
    process.exit(1);
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = projectRefFromEnvOrConfig();
  if (!token || !projectRef) {
    console.log(
      "SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_ID not set — prune skipped (manifest validated only).",
    );
    return;
  }
  if (!apply) {
    console.log(`Report only (pass --apply to delete). Recorded removals: ${removed.join(", ")}`);
  }

  const remoteSlugs = await fetchRemoteSlugs(projectRef, token);
  const { toDelete, alreadyGone } = planPrune(removed, local, remoteSlugs);

  for (const slug of alreadyGone) {
    console.log(`  already absent: ${slug}`);
  }
  if (!toDelete.length) {
    console.log(`Removed edge functions already pruned (${removed.length} recorded).`);
    return;
  }
  if (!apply) {
    console.log(`Would delete from ${projectRef}: ${toDelete.join(", ")}`);
    return;
  }
  for (const slug of toDelete) {
    const status = await deleteRemoteFunction(projectRef, token, slug);
    console.log(`  deleted: ${slug} (HTTP ${status})`);
  }
  console.log(`Pruned ${toDelete.length} removed edge function(s) from ${projectRef}.`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
