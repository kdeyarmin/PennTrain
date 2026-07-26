#!/usr/bin/env node
/**
 * Resident lifecycle journey coverage (program plan Phase 0, item 3).
 *
 * Every phase's exit gate in RESIDENT_360_PROGRAM_PLAN.md cites journey coverage, and the
 * cross-cutting requirements say the unimplemented-step count must fall each phase. This turns that
 * from a sentence into a build step: the pending count may go down, never up.
 *
 * The ceiling below is the ratchet. Implementing a step means lowering it in the same commit, which
 * is the point -- a coverage number nobody is forced to update stops being true within two phases.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, "../artifacts/caremetric-carebase/src/lib/residentJourney.ts");
const SPEC = resolve(HERE, "../artifacts/caremetric-carebase/e2e/resident-lifecycle.spec.ts");

// Lower this when a step is implemented. Raising it is a deliberate, explained act, not routine.
//
// History: raised 11 -> 12 on 2026-07-25 when step 1 (admit) was un-marked -- it had been declared
// implemented on a browser body that had never been executed, and CI failed it five rounds running.
// Lowered back to 11 the same day after the actual fault was reproduced OUTSIDE CI (the app served
// locally with the Supabase origin stubbed at the network layer): a transiently failing facilities
// query wedged every requireFacilityTypes route in a spinner/remount loop. Fixed in
// useVisibleFacilityTypes by deriving settled-ness from cache timestamps. The lesson stands: a step
// is "implemented" when its test has been RUN, not when its body has been written.
const PENDING_CEILING = 4;

const source = readFileSync(REGISTRY, "utf8");

// The registry is TypeScript and this script is plain Node, so the statuses are read out of the
// source rather than imported. Parsing is deliberately strict: a shape this script cannot read is
// reported as a failure rather than silently counted as zero, because "0 pending" from a broken
// parse reads exactly like a finished program.
const stepPattern = /\{\s*id:\s*"([a-z0-9-]+)",\s*ordinal:\s*(\d+),[\s\S]*?status:\s*"(implemented|pending)"/g;
const steps = [...source.matchAll(stepPattern)].map((match) => ({
  id: match[1],
  ordinal: Number(match[2]),
  status: match[3],
}));

const problems = [];

if (steps.length === 0) {
  problems.push(
    `could not read any steps from ${REGISTRY}. If the registry's shape changed, update this `
    + `script -- do not let it report zero.`,
  );
}

const declaredCount = (source.match(/^\s{2}\{$/gm) ?? []).length;
if (steps.length > 0 && declaredCount !== steps.length) {
  problems.push(
    `parsed ${steps.length} step(s) but the registry appears to declare ${declaredCount}. A step `
    + `whose shape this parser skipped would be invisible in the coverage number.`,
  );
}

const pending = steps.filter((step) => step.status === "pending");
const implemented = steps.filter((step) => step.status === "implemented");

if (pending.length > PENDING_CEILING) {
  problems.push(
    `${pending.length} step(s) are pending, above the ceiling of ${PENDING_CEILING}. Coverage may `
    + `only improve. If a step genuinely regressed, say so in the commit message and lower it `
    + `deliberately.`,
  );
}

// A step marked implemented in the registry but never named in the spec is a coverage number
// counting work that does not run anywhere.
try {
  const spec = readFileSync(SPEC, "utf8");
  for (const step of implemented) {
    if (!spec.includes(`"${step.id}"`)) {
      problems.push(
        `step "${step.id}" is marked implemented but the id does not appear in `
        + `e2e/resident-lifecycle.spec.ts, so nothing runs it.`,
      );
    }
  }
} catch (error) {
  problems.push(`could not read the journey spec at ${SPEC}: ${error.message}`);
}

const percent = steps.length === 0 ? 0 : Math.floor((implemented.length / steps.length) * 100);
console.log(
  `Resident lifecycle journey coverage: ${implemented.length}/${steps.length} steps implemented `
  + `(${percent}%), ${pending.length} pending (ceiling ${PENDING_CEILING}).`,
);
for (const step of steps.sort((a, b) => a.ordinal - b.ordinal)) {
  console.log(`  ${String(step.ordinal).padStart(2)}. [${step.status === "implemented" ? "x" : " "}] ${step.id}`);
}

if (problems.length > 0) {
  console.error(`\nJourney coverage check failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
