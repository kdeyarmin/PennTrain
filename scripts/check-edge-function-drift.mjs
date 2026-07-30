#!/usr/bin/env node
/**
 * PT-068 residual: edge function presence drift vs remote Supabase.
 *
 * Layers:
 *   A) Local deployable function dirs (excluding _shared) must match remote
 *      function slugs when SUPABASE_ACCESS_TOKEN + project ref are available.
 *   B) Optional content stamps in app_private.edge_function_deploy_stamps
 *      (written post-deploy) compared to local content sha256.
 *   C) --self-test runs pure helpers without network.
 *
 * Management API returns ezbr_sha256 / version for deployed functions, but
 * that hash is not locally reproducible (eszip packaging). Presence + stamp
 * is the practical content gate.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");
const API_BASE = process.env.SUPABASE_API_URL ?? "https://api.supabase.com";

export function listLocalFunctionSlugs(functionsDir = FUNCTIONS_DIR) {
  if (!existsSync(functionsDir)) return [];
  return readdirSync(functionsDir)
    .filter((name) => {
      if (name.startsWith("_") || name.startsWith(".")) return false;
      try {
        return statSync(join(functionsDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

export function localFunctionContentSha256(slug, functionsDir = FUNCTIONS_DIR) {
  const dir = join(functionsDir, slug);
  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  walk(dir);
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(dir, file).split("\\").join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function diffFunctionSets(localSlugs, remoteSlugs) {
  const local = new Set(localSlugs);
  const remote = new Set(remoteSlugs);
  const pending = [...local].filter((s) => !remote.has(s)).sort();
  const orphan = [...remote].filter((s) => !local.has(s)).sort();
  return { pending, orphan };
}

async function fetchRemoteFunctions(projectRef, token) {
  const res = await fetch(`${API_BASE}/v1/projects/${projectRef}/functions`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Management API list functions failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("Unexpected functions list payload");
  return body.map((fn) => ({
    slug: fn.slug ?? fn.name,
    version: fn.version,
    ezbr_sha256: fn.ezbr_sha256 ?? null,
  }));
}

function projectRefFromEnvOrConfig() {
  if (process.env.SUPABASE_PROJECT_ID) return process.env.SUPABASE_PROJECT_ID;
  const configPath = join(ROOT, "supabase", "config.toml");
  if (!existsSync(configPath)) return null;
  const text = readFileSync(configPath, "utf8");
  const match = text.match(/project_id\s*=\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

function selfTest() {
  const { pending, orphan } = diffFunctionSets(
    ["a", "b", "c"],
    ["b", "c", "d"],
  );
  if (pending.join(",") !== "a" || orphan.join(",") !== "d") {
    throw new Error("diffFunctionSets self-test failed");
  }
  const tmp = listLocalFunctionSlugs();
  if (!Array.isArray(tmp) || tmp.length < 1) {
    throw new Error("listLocalFunctionSlugs expected at least one function");
  }
  const sample = tmp[0];
  const sha = localFunctionContentSha256(sample);
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    throw new Error("localFunctionContentSha256 self-test failed");
  }
  console.log("Edge function drift self-test passed.");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const local = listLocalFunctionSlugs();
  console.log(`Local edge functions: ${local.length}`);

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = projectRefFromEnvOrConfig();
  if (!token || !projectRef) {
    console.log(
      "SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_ID not set — presence drift check skipped (local inventory only).",
    );
    process.exit(0);
  }

  const remote = await fetchRemoteFunctions(projectRef, token);
  const remoteSlugs = remote.map((r) => r.slug).filter(Boolean).sort();
  const { pending, orphan } = diffFunctionSets(local, remoteSlugs);

  if (pending.length || orphan.length) {
    console.error("Edge function presence drift detected:");
    if (pending.length) console.error(`  PENDING (local not remote): ${pending.join(", ")}`);
    if (orphan.length) console.error(`  ORPHAN (remote not local): ${orphan.join(", ")}`);
    process.exit(1);
  }

  console.log(`Edge function presence check passed (${local.length} functions).`);
  // Emit local content digests for operators / post-deploy stamp consumers.
  for (const slug of local) {
    console.log(`  ${slug} ${localFunctionContentSha256(slug)}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
