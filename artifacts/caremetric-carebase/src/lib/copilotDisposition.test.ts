import { describe, expect, it } from "vitest";
import {
  DISPOSITION_OPTIONS,
  dispositionBadgeClass,
  dispositionLabel,
  dispositionRequiresNote,
  isDispositionNoteValid,
  latestDispositionByRun,
} from "./copilotDisposition";

describe("disposition metadata", () => {
  it("offers exactly the three server-accepted decisions", () => {
    expect(DISPOSITION_OPTIONS.map((o) => o.value)).toEqual(["accepted", "needs_review", "rejected"]);
  });

  it("maps labels and semantic badge classes", () => {
    expect(dispositionLabel("accepted")).toBe("Accepted");
    expect(dispositionLabel("needs_review")).toBe("Needs review");
    expect(dispositionLabel("rejected")).toBe("Rejected");
    expect(dispositionBadgeClass("accepted")).toContain("bg-success");
    expect(dispositionBadgeClass("needs_review")).toContain("bg-warning");
    expect(dispositionBadgeClass("rejected")).toContain("bg-destructive");
  });

  it("falls back gracefully for an unknown value", () => {
    expect(dispositionLabel("bogus")).toBe("bogus");
    expect(dispositionBadgeClass("bogus")).toContain("bg-muted");
  });
});

describe("note requirements", () => {
  it("requires a note only for reject and needs_review", () => {
    expect(dispositionRequiresNote("accepted")).toBe(false);
    expect(dispositionRequiresNote("rejected")).toBe(true);
    expect(dispositionRequiresNote("needs_review")).toBe(true);
  });

  it("validates note length against the requirement", () => {
    expect(isDispositionNoteValid("accepted", "")).toBe(true); // note optional
    expect(isDispositionNoteValid("rejected", "")).toBe(false);
    expect(isDispositionNoteValid("rejected", "  bad  ")).toBe(false); // < 5 after trim
    expect(isDispositionNoteValid("rejected", "wrong citation")).toBe(true);
    expect(isDispositionNoteValid("needs_review", "check")).toBe(true); // exactly 5
  });
});

describe("latestDispositionByRun", () => {
  it("keeps only the most recent decision per run regardless of input order", () => {
    const rows = [
      { run_id: "a", disposition: "needs_review", created_at: "2026-07-20T10:00:00Z" },
      { run_id: "a", disposition: "accepted", created_at: "2026-07-22T09:00:00Z" },
      { run_id: "b", disposition: "rejected", created_at: "2026-07-21T12:00:00Z" },
    ];
    const latest = latestDispositionByRun(rows);
    expect(latest.get("a")?.disposition).toBe("accepted");
    expect(latest.get("b")?.disposition).toBe("rejected");
    expect(latest.size).toBe(2);
  });

  it("returns an empty map for no rows and ignores rows without a run id", () => {
    expect(latestDispositionByRun([]).size).toBe(0);
    const latest = latestDispositionByRun([{ run_id: "", disposition: "accepted", created_at: "2026-07-22T09:00:00Z" }]);
    expect(latest.size).toBe(0);
  });
});
