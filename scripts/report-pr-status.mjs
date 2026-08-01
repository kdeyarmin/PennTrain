#!/usr/bin/env node
/**
 * report-pr-status.mjs — Automate open-PR CI status checks for PennTrain.
 *
 * Usage:
 *   GITHUB_TOKEN=… node scripts/report-pr-status.mjs
 *   node scripts/report-pr-status.mjs --owner kdeyarmin --repo PennTrain
 *   node scripts/report-pr-status.mjs --fail-on-red
 *
 * Prints check conclusions for every open PR. Prefer the aggregate `ci-result`
 * job; also surfaces application / database / planning-registers / secret-scan.
 */

const OWNER = argValue("--owner") ?? process.env.GITHUB_OWNER ?? "kdeyarmin";
const REPO = argValue("--repo") ?? process.env.GITHUB_REPO ?? "PennTrain";
const FAIL_ON_RED = process.argv.includes("--fail-on-red");
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function gh(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "penntrain-report-pr-status",
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${path}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

function summarizeChecks(runs) {
  const byName = new Map();
  for (const run of runs) {
    if (!byName.has(run.name)) byName.set(run.name, run);
  }
  const required = [
    "ci-result",
    "application",
    "database",
    "planning-registers",
    "secret-scan",
    "migration-immutability",
  ];
  const lines = [];
  let red = false;
  let pending = false;
  for (const name of required) {
    const run = byName.get(name);
    if (!run) {
      lines.push(`${name}: (missing)`);
      continue;
    }
    const status = run.status === "completed" ? (run.conclusion ?? "unknown") : run.status;
    lines.push(`${name}: ${status}`);
    if (run.status !== "completed") pending = true;
    else if (["failure", "cancelled", "timed_out"].includes(run.conclusion)) red = true;
  }
  const overall = red ? "RED" : pending ? "PENDING" : "GREEN";
  return { overall, lines, red, pending };
}

async function main() {
  const pulls = await gh(`/repos/${OWNER}/${REPO}/pulls?state=open&per_page=30`);
  if (!Array.isArray(pulls) || pulls.length === 0) {
    console.log(`No open PRs on ${OWNER}/${REPO}`);
    return;
  }

  let anyRed = false;
  for (const pr of pulls) {
    const sha = pr.head.sha;
    const checks = await gh(`/repos/${OWNER}/${REPO}/commits/${sha}/check-runs?per_page=50`);
    const summary = summarizeChecks(checks.check_runs ?? []);
    if (summary.red && !pr.draft) anyRed = true;

    console.log(`\n#${pr.number} ${pr.draft ? "[DRAFT] " : ""}${pr.title}`);
    console.log(`  ${pr.html_url}`);
    console.log(`  head: ${pr.head.ref} @ ${sha.slice(0, 12)}`);
    console.log(`  mergeable_state: ${pr.mergeable_state ?? "n/a"}`);
    console.log(`  overall: ${summary.overall}`);
    for (const line of summary.lines) console.log(`    ${line}`);
  }

  console.log("");
  if (FAIL_ON_RED && anyRed) {
    console.error("One or more non-draft PRs are RED.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(2);
});
