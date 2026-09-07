#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Toolchain pin agreement check.
//
// Four tool versions decide what this repository builds and tests against -- Node, pnpm, the
// Supabase CLI, and Deno -- and each of them is written down in four to six different files:
// package.json, both composite actions, ci.yml, the devcontainer Dockerfile, the Codex setup
// script, .node-version/.nvmrc, and AGENTS.md. Nothing checked that they agreed.
//
// They agree today. They have not always: PennTrain_Comprehensive_Review_2026-07-20 records
// `.devcontainer/Dockerfile` pinning pnpm 10.28.1 while package.json and AGENTS.md said 11.13.0,
// so the container the repository ships for development ran a different package manager from the
// one CI ran. That is the failure mode this closes -- not a version being wrong, but two copies
// of it disagreeing and nothing noticing until behaviour diverges.
//
// The Supabase CLI pin is the one where a disagreement is most expensive, and the go-live review
// explains why (BACKLOG H19): 2.109.1's base image grants browser roles nothing on
// migration-created tables while newer images grant write access, so two pgTAP privilege
// assertions pass or fail purely on which CLI produced the local stack. "Verify on the pin" is
// only meaningful if every path installs the same pin.
//
// HOW IT WORKS. Each tool has one CANONICAL source of truth and a list of mirrors. Every mirror
// must match its pattern at least once -- a mirror that matches nothing is an error, because a
// rename or a reformat that stops this check from covering a file is exactly the silent gap it
// exists to close -- and every value it yields must equal the canonical one.
//
// WHAT IS DELIBERATELY NOT COVERED. The dated readiness plans under docs/ops quote versions too
// (`docs/ops/GO_LIVE_READINESS_REVIEW_PLAN.md`, `PILOT_READINESS_PLAN.md`,
// `RELEASE_READINESS_PLAN.md`). Those are records of what was run on a particular date, not
// current configuration: rewriting them on a version bump would falsify the record. AGENTS.md is
// covered, because it tells a person or an agent what to install right now.
//
// Usage:
//   node scripts/check-toolchain-pins.mjs
//   node scripts/check-toolchain-pins.mjs --self-test
//
// BACKLOG K8.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");

const SEMVER = String.raw`(\d+\.\d+\.\d+)`;

/**
 * @typedef {{file: string, pattern: RegExp, note: string}} PinSource
 * @typedef {{name: string, canonical: PinSource, mirrors: PinSource[]}} Tool
 */

/** @type {Tool[]} */
const TOOLS = [
  {
    name: "Node",
    canonical: {
      file: ".node-version",
      pattern: new RegExp(`^${SEMVER}\\s*$`),
      note: "the version actions/setup-node reads in every workflow",
    },
    mirrors: [
      { file: ".nvmrc", pattern: new RegExp(`^${SEMVER}\\s*$`), note: "nvm" },
      {
        file: ".devcontainer/Dockerfile",
        pattern: new RegExp(`^FROM node:${SEMVER}-`, "m"),
        note: "dev container base image",
      },
      {
        file: "package.json",
        pattern: new RegExp(`"node":\\s*">=${SEMVER}\\s`),
        note: "engines floor",
      },
      { file: "AGENTS.md", pattern: new RegExp(`Node\\s+${SEMVER}`, "g"), note: "agent runbook" },
    ],
  },
  {
    name: "pnpm",
    canonical: {
      file: "package.json",
      pattern: new RegExp(`"packageManager":\\s*"pnpm@${SEMVER}"`),
      note: "the corepack-activated package manager",
    },
    mirrors: [
      {
        file: "package.json",
        pattern: new RegExp(`"pnpm":\\s*">=${SEMVER}\\s`),
        note: "engines floor",
      },
      {
        file: ".github/actions/setup-node-pnpm/action.yml",
        pattern: new RegExp(`pnpm-version:[\\s\\S]*?default:\\s*"${SEMVER}"`),
        note: "composite action default (CI and deploy)",
      },
      {
        file: ".devcontainer/Dockerfile",
        pattern: new RegExp(`ARG PNPM_VERSION=${SEMVER}`),
        note: "dev container",
      },
      {
        file: "scripts/setup-codex-cloud.sh",
        pattern: new RegExp(`PNPM_VERSION:-${SEMVER}`),
        note: "Codex/Cursor cloud setup",
      },
      { file: "AGENTS.md", pattern: new RegExp(`pnpm\\s+${SEMVER}`, "g"), note: "agent runbook" },
    ],
  },
  {
    name: "Supabase CLI",
    canonical: {
      file: ".github/actions/setup-supabase-cli/action.yml",
      pattern: new RegExp(`version:[\\s\\S]*?default:\\s*"${SEMVER}"`),
      note: "the binary CI validates with and the deploy pushes with",
    },
    mirrors: [
      {
        file: "package.json",
        pattern: new RegExp(`supabase@${SEMVER}`, "g"),
        note: "db:migrate, db:reset:demo and check:database",
      },
      {
        file: "scripts/check-database-types.mjs",
        pattern: new RegExp(`supabase@${SEMVER}`, "g"),
        note: "generated-types comparison",
      },
      {
        file: ".devcontainer/Dockerfile",
        pattern: new RegExp(`FROM supabase/cli:v${SEMVER}`),
        note: "dev container",
      },
      {
        file: "AGENTS.md",
        pattern: new RegExp(`supabase@${SEMVER}`, "g"),
        note: "agent runbook",
      },
    ],
  },
  {
    name: "Deno",
    canonical: {
      file: ".github/workflows/ci.yml",
      pattern: new RegExp(`deno-version:\\s*v${SEMVER}`),
      note: "the runtime check:edge-functions type-checks against",
    },
    mirrors: [
      {
        file: ".devcontainer/Dockerfile",
        pattern: new RegExp(`FROM denoland/deno:bin-${SEMVER}`),
        note: "dev container",
      },
      {
        file: "scripts/setup-codex-cloud.sh",
        pattern: new RegExp(`DENO_VERSION:-v${SEMVER}`),
        note: "Codex/Cursor cloud setup",
      },
      { file: "AGENTS.md", pattern: new RegExp(`Deno\\s+v?${SEMVER}`, "g"), note: "agent runbook" },
    ],
  },
];

/**
 * Every version a source yields. Pure, so the fixtures can exercise the part that decides
 * whether a file is covered at all -- a pattern that silently stops matching is the failure
 * this check is most likely to develop itself.
 *
 * @param {string} text file contents
 * @param {RegExp} pattern with exactly one capture group; may be global
 * @returns {string[]} every captured version, in order of appearance
 */
export function extractVersions(text, pattern) {
  if (pattern.global) {
    return [...text.matchAll(pattern)].map((match) => match[1]);
  }
  const match = pattern.exec(text);
  return match ? [match[1]] : [];
}

/**
 * Compare one tool's mirrors against its canonical version.
 *
 * @param {string} canonicalVersion
 * @param {{file: string, note: string, versions: string[]}[]} mirrors
 * @returns {{uncovered: string[], mismatched: {file: string, note: string, version: string}[]}}
 */
export function compareMirrors(canonicalVersion, mirrors) {
  const uncovered = [];
  const mismatched = [];
  for (const mirror of mirrors) {
    if (mirror.versions.length === 0) {
      uncovered.push(mirror.file);
      continue;
    }
    for (const version of mirror.versions) {
      if (version !== canonicalVersion) {
        mismatched.push({ file: mirror.file, note: mirror.note, version });
      }
    }
  }
  return { uncovered, mismatched };
}

const FIXTURES = [
  ["one non-global match", () => extractVersions("v1.2.3", /v(\d+\.\d+\.\d+)/).join() === "1.2.3"],
  [
    "every global match",
    () => extractVersions("a 1.2.3 b 1.2.3 c 9.9.9", /(\d+\.\d+\.\d+)/g).join() === "1.2.3,1.2.3,9.9.9",
  ],
  ["no match yields nothing", () => extractVersions("nothing here", /v(\d+\.\d+\.\d+)/).length === 0],
  [
    "agreement passes",
    () => {
      const result = compareMirrors("1.2.3", [{ file: "a", note: "", versions: ["1.2.3"] }]);
      return result.uncovered.length === 0 && result.mismatched.length === 0;
    },
  ],
  [
    "a disagreeing mirror is reported",
    () => {
      const result = compareMirrors("1.2.3", [{ file: "a", note: "", versions: ["1.2.4"] }]);
      return result.mismatched.length === 1 && result.mismatched[0].version === "1.2.4";
    },
  ],
  [
    "one bad copy among several is still caught",
    () => {
      const result = compareMirrors("1.2.3", [{ file: "a", note: "", versions: ["1.2.3", "1.2.4"] }]);
      return result.mismatched.length === 1;
    },
  ],
  [
    // The check's own blind spot: a file whose pattern stops matching would otherwise pass
    // silently, and this check would quietly cover one file fewer than it claims to.
    "a mirror that matches nothing is an error, not a pass",
    () => {
      const result = compareMirrors("1.2.3", [{ file: "a", note: "", versions: [] }]);
      return result.uncovered.length === 1 && result.mismatched.length === 0;
    },
  ],
];

function runFixtures() {
  const failures = FIXTURES.filter(([, assertion]) => {
    try {
      return !assertion();
    } catch {
      return true;
    }
  }).map(([name]) => name);
  if (failures.length > 0) {
    console.error("check-toolchain-pins self-test failed:");
    for (const name of failures) console.error(`  - ${name}`);
    process.exit(1);
  }
  return FIXTURES.length;
}

async function read(file) {
  return readFile(join(REPO_ROOT, file), "utf8");
}

async function main() {
  const fixtureCount = runFixtures();
  if (process.argv.includes("--self-test")) {
    console.log(`check-toolchain-pins self-test passed (${fixtureCount} fixtures).`);
    return;
  }

  const problems = [];
  const summary = [];

  for (const tool of TOOLS) {
    const canonicalText = await read(tool.canonical.file);
    const canonicalVersions = extractVersions(canonicalText, tool.canonical.pattern);
    if (canonicalVersions.length === 0) {
      problems.push(
        `${tool.name}: could not read the canonical version from ${tool.canonical.file}.`,
        `  The pattern no longer matches. Fix the pattern in scripts/check-toolchain-pins.mjs --`,
        `  until it does, nothing is checking that ${tool.name} agrees anywhere.`,
      );
      continue;
    }
    const canonicalVersion = canonicalVersions[0];

    const mirrors = [];
    for (const mirror of tool.mirrors) {
      mirrors.push({
        file: mirror.file,
        note: mirror.note,
        versions: extractVersions(await read(mirror.file), mirror.pattern),
      });
    }

    const { uncovered, mismatched } = compareMirrors(canonicalVersion, mirrors);
    for (const file of uncovered) {
      problems.push(
        `${tool.name}: ${file} no longer states a version this check can find.`,
        `  Either the pin was removed (then remove it here too) or the file changed shape`,
        `  (then fix the pattern). A mirror that matches nothing is not agreement.`,
      );
    }
    for (const { file, note, version } of mismatched) {
      problems.push(
        `${tool.name}: ${file} pins ${version}, but ${tool.canonical.file} pins ${canonicalVersion}.`,
        `  ${file} is ${note}. Two copies of one toolchain version that disagree means two`,
        `  different environments, and the difference shows up as behaviour, not as an error.`,
      );
    }

    const copies = mirrors.reduce((total, mirror) => total + mirror.versions.length, 0);
    summary.push(`${tool.name} ${canonicalVersion} (${copies} copies agree)`);
  }

  if (problems.length > 0) {
    console.error("Toolchain pin check failed.\n");
    for (const line of problems) console.error(line);
    console.error("");
    process.exit(1);
  }

  console.log(`Toolchain pins agree: ${summary.join("; ")}.`);
}

main().catch((error) => {
  console.error("check-toolchain-pins crashed:", error);
  process.exit(1);
});
