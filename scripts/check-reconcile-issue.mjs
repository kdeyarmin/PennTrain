#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Fixtures for the reconcile-issue composite action's script.
//
// WHY THIS EXISTS. `.github/actions/reconcile-issue` is the single place four workflows now go to
// raise an alert and, more to the point, to CLOSE one: the deploy failure alert, the two
// dependency-advisory alerts, the DHS source alert, the full-history secret-scan alert and the
// `[ci] main is red` alert all route through it. It is the only code in this repository that
// closes GitHub issues on its own, it closes them by TITLE PREFIX, and until this file existed
// nothing tested it -- CI cannot, because the script only runs inside `actions/github-script`
// against a live API. A bug in it is not a red build; it is issues closing that should not, or an
// alert that never goes away.
//
// The three cases that matter most are the ones a careless rewrite would break silently:
//   - a pull request must never be closed (the issues endpoint returns PRs too);
//   - an unrelated issue must never be closed by a prefix match;
//   - an unknown `state` input must fail loudly rather than falling through to a no-op.
//
// HOW IT READS THE SCRIPT. The action keeps its JavaScript inline in the YAML, which is where
// `actions/github-script` wants it, so this extracts that block by indentation rather than
// depending on a YAML parser the root package does not have. If the action is reformatted enough
// to defeat the extractor, this check FAILS rather than silently testing nothing -- the safe
// direction, and the same rule scripts/check-toolchain-pins.mjs applies to its own patterns.
//
// Usage:
//   node scripts/check-reconcile-issue.mjs            # or --self-test; there is only one mode
//
// BACKLOG K1.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ACTION_PATH = join(SCRIPT_DIR, "..", ".github", "actions", "reconcile-issue", "action.yml");

/**
 * Pull the `script: |` block body out of the action YAML and dedent it.
 * Pure, and exported so its own failure modes are fixtured below.
 */
export function extractScriptBlock(yamlText) {
  const lines = yamlText.split("\n");
  const start = lines.findIndex((line) => /^\s*script:\s*\|\s*$/.test(line));
  if (start === -1) return null;

  const headerIndent = lines[start].match(/^(\s*)/)[1].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= headerIndent) break;
    body.push(line);
  }
  // Trailing blanks are the file's own line ending, not part of the block. Left in, they defeat
  // an exact comparison and make an EMPTY block look like a one-line one.
  while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
  if (body.length === 0) return null;

  const minIndent = Math.min(
    ...body.filter((line) => line.trim() !== "").map((line) => line.match(/^(\s*)/)[1].length),
  );
  return body.map((line) => line.slice(minIndent)).join("\n");
}

/** A recording stand-in for the `github`, `core` and `context` github-script provides. */
function harness(source, { issues, failCreateWithLabels = false, createErrorStatus = 422, failFirstCreate = false }) {
  const calls = { created: [], comments: [], updates: [], failed: null, warnings: [] };
  const github = {
    paginate: async () => issues,
    rest: {
      issues: {
        listForRepo: () => {},
        createComment: async (o) => {
          calls.comments.push({ number: o.issue_number, body: o.body });
        },
        create: async (o) => {
          // `failFirstCreate` models the case the retry is actually dangerous in: the request
          // SUCCEEDED server-side and only its response was lost. A retry then creates a second
          // issue for one condition. Recording the attempt before throwing is what makes that
          // visible to the assertions.
          calls.created.push({ title: o.title, labels: o.labels ?? null });
          if ((o.labels && failCreateWithLabels) || (failFirstCreate && calls.created.length === 1)) {
            const error = new Error("create rejected");
            error.status = createErrorStatus;
            throw error;
          }
          return { data: { number: 999 } };
        },
        update: async (o) => {
          calls.updates.push({ number: o.issue_number, state: o.state, reason: o.state_reason });
        },
      },
    },
  };
  const core = {
    info: () => {},
    warning: (message) => calls.warnings.push(message),
    setFailed: (message) => {
      calls.failed = message;
    },
  };
  const context = { repo: { owner: "owner", repo: "repo" } };
  const run = new Function(
    "github",
    "core",
    "context",
    `return (async () => { ${source} })()`,
  );
  return { calls, invoke: () => run(github, core, context) };
}

const OPEN_ISSUES = [
  { number: 1, title: "[deploy] Production migration/function deploy failed (aaaaaaa)" },
  { number: 2, title: "[deploy] Production drift check failed (bbbbbbb)" },
  { number: 3, title: "[deps] High or critical advisory affects main" },
  // The issues endpoint returns pull requests as well. Closing one would be a very unwelcome
  // surprise, and its title deliberately matches the prefix used below.
  { number: 4, title: "[deploy] a pull request that must not be touched", pull_request: { url: "x" } },
  { number: 5, title: "Unrelated bug report" },
];

// Every RECONCILE_* variable, because the composite action maps all of them into `env:` and every
// input carries a default of "". An unset variable is therefore a state the action can never be
// in, and testing against one tests the wrong program: the script reads several of them AFTER its
// first `await`, so a harness that leaves them undefined throws where the real thing would not.
const INPUT_DEFAULTS = {
  RECONCILE_STATE: "",
  RECONCILE_TITLE: "",
  RECONCILE_TITLE_PREFIX: "",
  RECONCILE_BODY: "",
  RECONCILE_BUMP_COMMENT: "",
  RECONCILE_CLOSE_COMMENT: "",
  RECONCILE_LABELS: "",
};

/**
 * Run `fn` with exactly those variables set, and — the part that matters — AWAIT it before
 * restoring them. The script under test reads `RECONCILE_BODY`, `RECONCILE_LABELS` and both
 * comment inputs after awaiting the issue listing; a synchronous try/finally around an async
 * call restores the environment while the script is still suspended, so it sees nothing.
 */
async function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("RECONCILE_")) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
  }
  Object.assign(process.env, INPUT_DEFAULTS, vars);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("RECONCILE_")) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
}

const CASES = [
  {
    name: "open with no existing issue creates exactly one, with its labels",
    env: { RECONCILE_STATE: "open", RECONCILE_TITLE: "[ci] main is red", RECONCILE_BODY: "b", RECONCILE_LABELS: "a,b" },
    assert: (c) =>
      c.created.length === 1 && c.created[0].labels.join() === "a,b" && c.comments.length === 0,
  },
  {
    name: "open with the issue already there bumps it and creates nothing",
    env: {
      RECONCILE_STATE: "open",
      RECONCILE_TITLE: "[deps] High or critical advisory affects main",
      RECONCILE_BUMP_COMMENT: "still failing",
    },
    assert: (c) => c.created.length === 0 && c.comments.length === 1 && c.comments[0].number === 3,
  },
  {
    name: "a label that does not exist yet does not cost us the alert",
    env: { RECONCILE_STATE: "open", RECONCILE_TITLE: "[ci] fresh", RECONCILE_BODY: "b", RECONCILE_LABELS: "missing" },
    options: { failCreateWithLabels: true },
    assert: (c) =>
      c.created.length === 2 && c.created[0].labels !== null && c.created[1].labels === null &&
      c.warnings.length === 1,
  },
  {
    // The retry exists for a rejected label and nothing else. Repeating a request that had no
    // labels cannot succeed where the first failed, and if the first actually created the issue
    // and only its response was lost, the retry is how one condition gets two issues.
    name: "an unlabelled create is never retried, so a lost response cannot duplicate the alert",
    env: { RECONCILE_STATE: "open", RECONCILE_TITLE: "[ci] unlabelled", RECONCILE_BODY: "b" },
    options: { failFirstCreate: true, createErrorStatus: 502 },
    expectThrows: true,
    // Exactly one attempt. The old code retried here and would have made a second issue for a
    // condition that already had one -- the failure this whole action exists to prevent.
    assert: (c) => c.created.length === 1,
  },
  {
    name: "a labelled create failing for a non-label reason is not retried either",
    env: { RECONCILE_STATE: "open", RECONCILE_TITLE: "[ci] server error", RECONCILE_BODY: "b", RECONCILE_LABELS: "x" },
    options: { failCreateWithLabels: true, createErrorStatus: 500 },
    expectThrows: true,
    assert: (c) => c.created.length === 1 && c.warnings.length === 0,
  },
  {
    name: "closed by prefix retires every alert for that condition",
    env: {
      RECONCILE_STATE: "closed",
      RECONCILE_TITLE: "[deploy] Production migration/function deploy failed",
      RECONCILE_TITLE_PREFIX: "[deploy] ",
      RECONCILE_CLOSE_COMMENT: "resolved",
    },
    assert: (c) =>
      c.updates.map((u) => u.number).sort().join() === "1,2" &&
      c.comments.length === 2 &&
      c.updates.every((u) => u.state === "closed" && u.reason === "completed"),
  },
  {
    name: "closed by prefix never closes a pull request",
    env: {
      RECONCILE_STATE: "closed",
      RECONCILE_TITLE: "[deploy] Production migration/function deploy failed",
      RECONCILE_TITLE_PREFIX: "[deploy] ",
    },
    assert: (c) => !c.updates.some((u) => u.number === 4),
  },
  {
    name: "closed by prefix never closes an unrelated issue",
    env: {
      RECONCILE_STATE: "closed",
      RECONCILE_TITLE: "[deploy] Production migration/function deploy failed",
      RECONCILE_TITLE_PREFIX: "[deploy] ",
    },
    assert: (c) => !c.updates.some((u) => u.number === 5 || u.number === 3),
  },
  {
    name: "closed with no prefix matches the exact title only",
    env: { RECONCILE_STATE: "closed", RECONCILE_TITLE: "[deps] High or critical advisory affects main" },
    assert: (c) => c.updates.length === 1 && c.updates[0].number === 3,
  },
  {
    name: "closed with nothing matching writes nothing at all",
    env: { RECONCILE_STATE: "closed", RECONCILE_TITLE: "[secrets] no such alert" },
    assert: (c) => c.updates.length === 0 && c.comments.length === 0,
  },
  {
    name: "an unknown state fails the step rather than doing nothing quietly",
    env: { RECONCILE_STATE: "sideways", RECONCILE_TITLE: "x" },
    assert: (c) => c.failed !== null && c.created.length === 0 && c.updates.length === 0,
  },
];

const EXTRACTOR_FIXTURES = [
  ["extracts and dedents a block", () => extractScriptBlock("a:\n  script: |\n    one\n    two\n") === "one\ntwo"],
  ["stops at the next key", () => extractScriptBlock("a:\n  script: |\n    one\n  next: 2\n") === "one"],
  ["keeps relative indentation", () => extractScriptBlock("a:\n  script: |\n    if (x) {\n      y();\n    }\n") === "if (x) {\n  y();\n}"],
  ["returns null when there is no script block", () => extractScriptBlock("a:\n  run: echo hi\n") === null],
  ["returns null when the block is empty", () => extractScriptBlock("a:\n  script: |\n") === null],
];

async function main() {
  let failures = 0;

  for (const [name, assertion] of EXTRACTOR_FIXTURES) {
    let ok = false;
    try {
      ok = assertion();
    } catch {
      ok = false;
    }
    if (!ok) {
      failures += 1;
      console.error(`✗ extractor: ${name}`);
    }
  }

  const source = extractScriptBlock(await readFile(ACTION_PATH, "utf8"));
  if (!source) {
    console.error(
      "✗ could not find the `script: |` block in .github/actions/reconcile-issue/action.yml.\n" +
        "  The action was reformatted and this check is now testing nothing. Fix the extractor.",
    );
    process.exit(1);
  }

  for (const testCase of CASES) {
    const { calls, invoke } = harness(source, {
      issues: OPEN_ISSUES,
      ...(testCase.options ?? {}),
    });
    let threw = false;
    try {
      await withEnv(testCase.env, invoke);
    } catch (error) {
      threw = true;
      if (!testCase.expectThrows) {
        failures += 1;
        console.error(`✗ ${testCase.name} threw unexpectedly: ${error.message}`);
        continue;
      }
    }
    if (testCase.expectThrows && !threw) {
      failures += 1;
      console.error(`✗ ${testCase.name} should have propagated the error and did not`);
      continue;
    }
    if (!testCase.assert(calls)) {
      failures += 1;
      console.error(`✗ ${testCase.name}\n    calls: ${JSON.stringify(calls)}`);
    }
  }

  if (failures > 0) {
    console.error(`\nreconcile-issue self-test FAILED (${failures} case(s)).`);
    process.exit(1);
  }
  console.log(
    `reconcile-issue self-test passed (${CASES.length} behaviours + ${EXTRACTOR_FIXTURES.length} extractor fixtures).`,
  );
}

main().catch((error) => {
  console.error("check-reconcile-issue crashed:", error);
  process.exit(1);
});
