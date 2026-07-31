#!/usr/bin/env node
/**
 * Post-deploy stamp of local edge function content digests.
 * Writes one line per function to stdout as JSON (operators can persist
 * via Management SQL or CI artifacts). Does not require a DB migration —
 * deploy workflow archives the stamp file as an artifact.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listLocalFunctionSlugs,
  localFunctionContentSha256,
} from "./check-edge-function-drift.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const outPath = process.argv[2] || join(ROOT, "edge-function-deploy-stamp.json");

const gitSha = process.env.DEPLOY_SHA || process.env.GITHUB_SHA || process.env.GIT_SHA || "unknown";
const stamp = {
  gitSha,
  stampedAt: new Date().toISOString(),
  functions: Object.fromEntries(
    listLocalFunctionSlugs().map((slug) => [
      slug,
      localFunctionContentSha256(slug),
    ]),
  ),
};

writeFileSync(outPath, `${JSON.stringify(stamp, null, 2)}\n`);
console.log(`Wrote edge function deploy stamp (${Object.keys(stamp.functions).length} functions) to ${outPath}`);
