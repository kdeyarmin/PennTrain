import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attemptIsOpen,
  attemptStatusLabel,
  decisionIssue,
  outstandingChecklistItems,
  type ChecklistRow,
} from "./certificationAttempt";

const APPROVE_MIGRATION = join(
  __dirname, "..", "..", "..", "..",
  "supabase/migrations/20260711213000_phase3_hris_and_qualification_lifecycles.sql",
);

function row(overrides: {
  key?: string;
  evidenceRequired?: boolean;
  signatureRequired?: boolean;
  recorded?: Partial<ChecklistRow["recorded"]> | null;
} = {}): ChecklistRow {
  const recorded = overrides.recorded === null || overrides.recorded === undefined
    ? null
    : {
      checklist_item_id: overrides.key ?? "item",
      result: "met",
      evidence: {},
      signed_at: null,
      ...overrides.recorded,
    };
  return {
    item: {
      id: overrides.key ?? "item",
      item_key: overrides.key ?? "item",
      prompt: "Did the thing",
      evidence_required: overrides.evidenceRequired ?? false,
      signature_required: overrides.signatureRequired ?? false,
    },
    recorded: recorded as ChecklistRow["recorded"],
  };
}

describe("outstanding checklist items", () => {
  it("counts an item nobody has recorded", () => {
    expect(outstandingChecklistItems([row()])[0].missing).toBe("not yet observed");
  });

  it("counts an evidence-required item recorded with no evidence", () => {
    const outstanding = outstandingChecklistItems([
      row({ evidenceRequired: true, recorded: { evidence: {} } }),
    ]);
    expect(outstanding[0].missing).toBe("evidence required");
  });

  it("accepts an evidence-required item once evidence is present", () => {
    expect(outstandingChecklistItems([
      row({ evidenceRequired: true, recorded: { evidence: { observed: "wristband checked" } } }),
    ])).toEqual([]);
  });

  it("counts a signature-required item with no signature", () => {
    expect(outstandingChecklistItems([
      row({ signatureRequired: true, recorded: { signed_at: null } }),
    ])[0].missing).toBe("signature required");
  });

  it("treats not_applicable as complete, whatever the item demands", () => {
    // An item that genuinely does not apply cannot carry evidence of something that did not happen.
    // The server's record path permits exactly this, so the screen must not disagree.
    expect(outstandingChecklistItems([
      row({ evidenceRequired: true, signatureRequired: true, recorded: { result: "not_applicable" } }),
    ])).toEqual([]);
  });

  it("counts a not_met item as complete — a failure is an observation, not a gap", () => {
    expect(outstandingChecklistItems([row({ recorded: { result: "not_met" } })])).toEqual([]);
  });

  it("reports every outstanding item, not just the first", () => {
    expect(outstandingChecklistItems([
      row({ key: "a" }),
      row({ key: "b", evidenceRequired: true, recorded: { evidence: {} } }),
      row({ key: "c", recorded: {} }),
    ]).map((entry) => entry.itemKey)).toEqual(["a", "b"]);
  });

  it("treats a non-object evidence value as absent", () => {
    // The server compares against `'{}'::jsonb`; anything that is not a populated object is not
    // evidence, and guessing otherwise would let an attempt through that approve then refuses.
    for (const evidence of [null, undefined, "written down", 42]) {
      expect(outstandingChecklistItems([
        row({ evidenceRequired: true, recorded: { evidence } }),
      ])).toHaveLength(1);
    }
  });
});

describe("status", () => {
  it("labels every status the schema permits", () => {
    for (const status of ["in_progress", "submitted", "passed", "failed", "voided"]) {
      expect(attemptStatusLabel(status)).not.toBe(status);
    }
  });

  it("counts only the stages that still owe something as open", () => {
    expect(attemptIsOpen("in_progress")).toBe(true);
    expect(attemptIsOpen("submitted")).toBe(true);
    for (const status of ["passed", "failed", "voided"]) expect(attemptIsOpen(status)).toBe(false);
  });
});

describe("decision", () => {
  it("requires a typed name to sign", () => {
    expect(decisionIssue({ reason: "Observed a full pass.", typedName: "  " })).toContain("sign");
  });

  it("uses the same minimum reason length the approval RPC enforces", () => {
    // Pinned to the SQL so the form cannot start accepting what the server rejects.
    const sql = readFileSync(APPROVE_MIGRATION, "utf8");
    const approve = sql.slice(sql.indexOf("create or replace function public.approve_certification_attempt"));
    const guard = approve.match(/length\(btrim\(coalesce\(p_reason, ''\)\)\) < (\d+)/);
    expect(guard, "reason guard not found").toBeTruthy();
    const minimum = Number(guard![1]);
    expect(decisionIssue({ reason: "a".repeat(minimum - 1), typedName: "Ada" })).not.toBeNull();
    expect(decisionIssue({ reason: "a".repeat(minimum), typedName: "Ada" })).toBeNull();
  });
});
