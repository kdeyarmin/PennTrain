import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKIN_TOKEN_REVOKE_REASON_MIN_LENGTH,
  checkinTokenRevokeReasonIssue,
} from "./classCheckinTokens";

const MIGRATION = join(
  __dirname, "..", "..", "..", "..",
  "supabase/migrations/20260714233041_remediate_p2_security_findings.sql",
);

describe("rule pinned to the migration", () => {
  it("uses the same minimum reason length revoke_class_checkin_tokens enforces", () => {
    // Read out of the SQL rather than trusted. The UI enabled its Revoke button at five characters
    // while the RPC refused anything under ten, so the trainer could submit a reason the server
    // would always reject -- and the codes they were revoking stayed live.
    const sql = readFileSync(MIGRATION, "utf8");
    const start = sql.indexOf("create or replace function public.revoke_class_checkin_tokens(");
    expect(start, "revoke_class_checkin_tokens not found in the migration").toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf("\n$$;", start));
    const guard = /length\(btrim\(coalesce\(p_reason, ''\)\)\) < (\d+)/.exec(body);
    expect(guard, "reason guard not found in the function body").not.toBeNull();
    expect(Number(guard![1])).toBe(CHECKIN_TOKEN_REVOKE_REASON_MIN_LENGTH);
  });
});

describe("revocation reason", () => {
  it("requires a reason at all, and says where it is kept", () => {
    const issue = checkinTokenRevokeReasonIssue("   ");
    expect(issue).toContain("required");
    expect(issue).toContain("audit log");
  });

  it("names the minimum when the reason is too short", () => {
    expect(checkinTokenRevokeReasonIssue("shared")).toContain(
      String(CHECKIN_TOKEN_REVOKE_REASON_MIN_LENGTH),
    );
  });

  it("accepts a reason exactly at the boundary", () => {
    // The server's guard is `< 10`, so ten characters is acceptable and nine is not.
    expect(checkinTokenRevokeReasonIssue("a".repeat(CHECKIN_TOKEN_REVOKE_REASON_MIN_LENGTH))).toBeNull();
    expect(
      checkinTokenRevokeReasonIssue("a".repeat(CHECKIN_TOKEN_REVOKE_REASON_MIN_LENGTH - 1)),
    ).not.toBeNull();
  });

  it("measures the trimmed reason, as the server does", () => {
    expect(checkinTokenRevokeReasonIssue(`   ${"a".repeat(9)}   `)).not.toBeNull();
  });
});
