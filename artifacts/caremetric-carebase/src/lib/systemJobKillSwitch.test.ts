import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  killSwitchBadgeLabel,
  killSwitchButtonTitle,
  killSwitchDeadNotice,
  killSwitchStopsJob,
  manualRunUnavailableReason,
} from "./systemJobKillSwitch";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

describe("killSwitchStopsJob", () => {
  it("follows the RPC predicate in both directions", () => {
    // The defect was a console that answered from something other than this column: an Edge job
    // whose worker claims (kill_switch_can_stop true) was being told its switch was dead.
    expect(killSwitchStopsJob({ kill_switch_enabled: false, kill_switch_can_stop: true })).toBe(true);
    expect(killSwitchStopsJob({ kill_switch_enabled: true, kill_switch_can_stop: false })).toBe(false);
  });
});

describe("kill switch copy", () => {
  it("says nothing at all about a switch that works", () => {
    const job = { kill_switch_enabled: true, kill_switch_can_stop: true };
    expect(killSwitchDeadNotice(job)).toBeNull();
    expect(killSwitchBadgeLabel(job)).toBeNull();
    expect(killSwitchButtonTitle(job)).toBeUndefined();
  });

  it("warns in the right tense for a switch that cannot act", () => {
    const before = killSwitchDeadNotice({ kill_switch_enabled: false, kill_switch_can_stop: false });
    const after = killSwitchDeadNotice({ kill_switch_enabled: true, kill_switch_can_stop: false });
    expect(before).toContain("will not stop it");
    expect(after).toContain("keeps running");
    expect(killSwitchBadgeLabel({ kill_switch_enabled: false, kill_switch_can_stop: false }))
      .toBe("Kill switch inert");
  });

  it("gives the reason the predicate actually tests, not the retired one", () => {
    // 20260906170000 replaced "does the cron command mention execute_registered_sql_job" with
    // "does this job's worker claim". Copy that still blamed the SQL wrapper would be a second
    // wrong explanation over a now-correct badge.
    for (const enabled of [true, false]) {
      const notice = killSwitchDeadNotice({ kill_switch_enabled: enabled, kill_switch_can_stop: false })!;
      expect(notice).toContain("never claims a run");
      expect(notice).not.toContain("SQL wrapper");
    }
    expect(killSwitchButtonTitle({ kill_switch_enabled: false, kill_switch_can_stop: false }))
      .toContain("never claims a run");
  });
});

describe("manualRunUnavailableReason", () => {
  it("explains the absent Run now for a job that is not manually rerunnable", () => {
    expect(manualRunUnavailableReason({ retry_mode: "none" })).toBeTruthy();
    expect(manualRunUnavailableReason({ retry_mode: "automatic" })).toBeNull();
    expect(manualRunUnavailableReason({ retry_mode: "manual" })).toBeNull();
  });
});

describe("the watchdog's registration", () => {
  it("is the definition both behaviours hang on", () => {
    // Both of this module's rules exist for one row, so the row is pinned: system-job-watchdog is
    // the only definition that does not claim, and it is retry_mode 'none' so no manual run is
    // offered for it. If either changes, the copy above is describing nothing.
    const sql = readFileSync(
      join(REPO_ROOT, "supabase", "migrations", "20260906170000_a_kill_switch_the_console_called_dead.sql"),
      "utf8",
    );
    expect(sql).toContain("set claims_before_running = false");
    expect(sql).toContain("set retry_mode = 'none'");
    expect(sql).toMatch(/where job_key = 'system-job-watchdog' and claims_before_running/);
    expect(sql).toMatch(/where job_key = 'system-job-watchdog' and retry_mode <> 'none'/);
  });
});
