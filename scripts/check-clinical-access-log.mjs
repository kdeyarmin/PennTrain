#!/usr/bin/env node
/**
 * A clinical record read must go through a function that logs it.
 *
 * app_private.clinical_access_log exists so a facility can answer "who looked at this resident's
 * record" -- the question a HIPAA accounting-of-disclosures request, or a suspected snooping
 * incident, turns on. Only a SECURITY DEFINER function writes to it. A direct PostgREST select is
 * scoped by RLS and is therefore not a leak, but it writes nothing, so it is invisible to that
 * question.
 *
 * That is how the gap this gate closes was shipped: the care documentation tab, the FHIR half of
 * the clinical chart and the resident timeline all read the clinical tables directly, so the three
 * busiest doors into a chart produced no log row at all, while the two least-used ones did. Nothing
 * was wrong with any single line -- the reads were correct, scoped and reviewed. The invariant just
 * had nowhere to live except in someone's memory.
 *
 * So: client source may not name a clinical table at all. If a surface needs clinical content, it
 * calls an RPC that logs the access first (see get_resident_clinical_care, get_resident_clinical_fhir,
 * get_resident_clinical_chart, get_resident_clinical_observations). If it needs something that is
 * genuinely not clinical content -- a count, a date, an id -- that is a judgement call, and it goes
 * in clinical-read-allowlist.json with a reason, in the change set that makes it true.
 *
 * The table list is DERIVED from the migrations, not hand-maintained: a clinical table is one whose
 * RLS is written in terms of app_private.clinical_record_visible, which is the schema's own
 * definition of "this is a resident's clinical record". A table added tomorrow is covered tomorrow.
 * A parser that suddenly finds implausibly few tables fails loudly rather than passing vacuously.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { stripSqlComments } from "./lib/sqlComments.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "artifacts/caremetric-carebase/src");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const ALLOWLIST = resolve(HERE, "clinical-read-allowlist.json");

// If the policy parser breaks, this floor turns a vacuous pass into a loud failure. It is the count
// at adoption (ten) minus a little slack for a table legitimately retired.
const MINIMUM_EXPECTED_TABLES = 8;

/** Tables whose row-level security is written in terms of clinical_record_visible. */
export function clinicalTablesFromSql(sql) {
  const found = new Set();
  const text = stripSqlComments(sql);
  // A policy statement runs from `create policy` to the terminating semicolon. Policy expressions
  // contain no bare semicolons, so this does not need a full parser.
  for (const match of text.matchAll(/create\s+policy\s+[\s\S]*?;/gi)) {
    const statement = match[0];
    if (!/clinical_record_visible/i.test(statement)) continue;
    const on = statement.match(/\bon\s+(?:public\.)?"?([a-z0-9_]+)"?/i);
    if (on) found.add(on[1].toLowerCase());
  }
  return found;
}

/** Every `supabase.from("<table>")` in a client file, with its offset. */
export function tableReadsIn(source, tables) {
  const hits = [];
  for (const match of source.matchAll(/\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)/gi)) {
    const table = match[1].toLowerCase();
    if (tables.has(table)) hits.push({ table, index: match.index ?? 0 });
  }
  return hits;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

if (process.argv.includes("--self-test")) {
  const failures = [];
  const derived = clinicalTablesFromSql(`
    create policy clinical_care_plans_select on public.clinical_care_plans
      for select to authenticated
      using (app_private.clinical_record_visible(organization_id, facility_id));
    -- a policy on an unrelated table must not be picked up
    create policy shifts_select on public.shifts for select to authenticated using (true);
    create policy goals_select on public.clinical_care_plan_goals for select to authenticated
      using (exists (select 1 from clinical_care_plans p
        where p.id = care_plan_id and app_private.clinical_record_visible(p.organization_id, p.facility_id)));
  `);
  if (!derived.has("clinical_care_plans")) failures.push("direct policy not derived");
  if (!derived.has("clinical_care_plan_goals")) failures.push("policy via a subquery not derived");
  if (derived.has("shifts")) failures.push("unrelated policy wrongly derived");

  const commented = clinicalTablesFromSql(`
    -- create policy ghost on public.clinical_ghost using (app_private.clinical_record_visible(a, b));
  `);
  if (commented.size !== 0) failures.push("a commented-out policy was counted");

  const tables = new Set(["clinical_care_plans"]);
  const reads = tableReadsIn(
    'supabase.from("clinical_care_plans").select("*"); supabase.from("shifts").select("*");',
    tables,
  );
  if (reads.length !== 1 || reads[0].table !== "clinical_care_plans") {
    failures.push("client read detection wrong");
  }
  if (tableReadsIn('supabase.rpc("get_resident_clinical_care", {})', tables).length !== 0) {
    failures.push("an RPC call was mistaken for a table read");
  }

  if (failures.length > 0) {
    console.error(`Clinical-access-log check self-test failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Clinical-access-log check self-test passed.");
  process.exit(0);
}

const tables = new Set();
for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
  for (const table of clinicalTablesFromSql(readFileSync(join(MIGRATIONS, file), "utf8"))) {
    tables.add(table);
  }
}

if (tables.size < MINIMUM_EXPECTED_TABLES) {
  console.error(
    `Clinical-access-log check aborted: derived only ${tables.size} clinical table(s) from `
    + `supabase/migrations, below the ${MINIMUM_EXPECTED_TABLES} expected. The policy parser has `
    + `probably stopped matching. Fix it rather than lowering the floor -- passing on an empty `
    + `table list would make this check silently vacuous.`,
  );
  process.exit(1);
}

const allowlist = new Map(
  Object.entries(JSON.parse(readFileSync(ALLOWLIST, "utf8")).allowed ?? {}).map(
    ([file, entry]) => [file, new Set(entry.tables ?? [])],
  ),
);

const problems = [];
for (const file of walk(SRC)) {
  const rel = relative(join(ROOT, "artifacts/caremetric-carebase"), file);
  const source = readFileSync(file, "utf8");
  for (const { table, index } of tableReadsIn(source, tables)) {
    if (allowlist.get(rel)?.has(table)) continue;
    const line = source.slice(0, index).split("\n").length;
    problems.push(
      `${rel}:${line} reads the clinical table \`${table}\` directly, which writes nothing to `
      + `app_private.clinical_access_log. Call a logged RPC instead, or record the read in `
      + `scripts/clinical-read-allowlist.json with a reason if it carries no clinical content.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`Clinical-access-log check failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const allowed = [...allowlist.values()].reduce((n, set) => n + set.size, 0);
console.log(
  `Clinical-access-log check passed (${tables.size} clinical tables derived from migrations, `
  + `${allowed} adjudicated non-clinical read(s) allowlisted).`,
);
