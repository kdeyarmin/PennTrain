import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract test for the "Run now" control on /admin/system-jobs (BACKLOG.md J82).
 *
 * The button posts to the `run-system-job` Edge Function, which resolves a job key against
 * `EDGE_JOBS` and `SQL_WRAPPER_JOBS`. The second describes SQL that lives in a migration, so it can
 * drift silently, and drift here is not a harmless mismatch: a key the dispatcher believes is a
 * registered SQL job but the wrapper has no arm for raises 22023 INSIDE the wrapper, whose own
 * exception handler then finalizes the queued run as FAILED. The click manufactures the evidence
 * that the job is broken.
 *
 * That is exactly what "Run now" on the System job watchdog did on every press, until
 * 20260906170000 registered that definition `retry_mode = 'none'` so `request_system_job_rerun`
 * refuses it before a run exists. The dispatcher's pre-flight refusal is the general form of the
 * same guard, and this test is what keeps its list true.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const DISPATCHER = join(REPO_ROOT, "supabase", "functions", "run-system-job", "index.ts");
// The migration that last rewrote execute_registered_sql_job, teaching it the nineteen direct cron
// entries and leaving the watchdog out on purpose.
const WRAPPER_MIGRATION = join(
  REPO_ROOT,
  "supabase",
  "migrations",
  "20260905240000_nineteen_jobs_the_control_plane_could_not_reach.sql",
);
const RETRY_MODE_MIGRATION = join(
  REPO_ROOT,
  "supabase",
  "migrations",
  "20260906170000_a_kill_switch_the_console_called_dead.sql",
);

function dispatcherSource(): string {
  return readFileSync(DISPATCHER, "utf8");
}

/** The text of one top-level `const NAME = ...` declaration, up to its closing line. */
function declarationBlock(source: string, name: string, terminator: string): string {
  const start = source.indexOf(`const ${name}`);
  expect(start, `${name} not found in run-system-job/index.ts`).toBeGreaterThan(-1);
  const end = source.indexOf(terminator, start);
  expect(end, `${name} declaration is not terminated by ${terminator.trim()}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function edgeJobKeys(source: string): string[] {
  return [...declarationBlock(source, "EDGE_JOBS", "\n};").matchAll(/"([a-z0-9][a-z0-9-]*)"\s*:/g)]
    .map((match) => match[1])
    .sort();
}

function wrapperJobKeys(source: string): string[] {
  return [...declarationBlock(source, "SQL_WRAPPER_JOBS", "\n]);").matchAll(/"([a-z0-9][a-z0-9-]*)",/g)]
    .map((match) => match[1])
    .sort();
}

/** Every `when '<key>' then` arm inside execute_registered_sql_job's case statement. */
function wrapperCaseArms(): string[] {
  const sql = readFileSync(WRAPPER_MIGRATION, "utf8");
  const start = sql.indexOf("case p_job_key");
  const end = sql.indexOf("Job is not a registered SQL worker", start);
  expect(start, "case p_job_key not found").toBeGreaterThan(-1);
  expect(end, "wrapper else-arm not found").toBeGreaterThan(start);
  return [...sql.slice(start, end).matchAll(/when '([a-z0-9-]+)'/g)]
    .map((match) => match[1])
    .sort();
}

describe("run-system-job dispatch table", () => {
  it("registers exactly the SQL jobs execute_registered_sql_job has an arm for", () => {
    const keys = wrapperJobKeys(dispatcherSource());
    expect(keys).toEqual(wrapperCaseArms());
    expect(keys.length).toBeGreaterThan(0);
  });

  it("keeps the Edge and SQL maps disjoint", () => {
    const source = dispatcherSource();
    const all = [...edgeJobKeys(source), ...wrapperJobKeys(source)];
    expect(all.length).toBe(new Set(all).size);
  });

  it("refuses a key with no dispatch path before any run is queued", () => {
    const source = dispatcherSource();
    const guard = source.indexOf("hasDispatchPath(body.jobKey)");
    // The call site, not the comment above SQL_WRAPPER_JOBS that also names the RPC.
    const queue = source.indexOf('rpc("request_system_job_rerun"');
    expect(guard, "the dispatch-path guard is gone").toBeGreaterThan(-1);
    // Ordering is the whole fix: refusing after the run is queued still leaves the false failed run.
    expect(guard).toBeLessThan(queue);
  });

  it("has no dispatch path for the watchdog, which is not manually rerunnable", () => {
    const source = dispatcherSource();
    expect(edgeJobKeys(source)).not.toContain("system-job-watchdog");
    expect(wrapperJobKeys(source)).not.toContain("system-job-watchdog");
    // ...because the definition itself now says so, which is where the fix belongs.
    expect(readFileSync(RETRY_MODE_MIGRATION, "utf8")).toMatch(
      /set retry_mode = 'none'[\s\S]{0,200}where job_key = 'system-job-watchdog'/,
    );
  });
});
