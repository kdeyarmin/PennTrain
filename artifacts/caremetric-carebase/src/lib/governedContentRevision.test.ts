import { describe, expect, it } from "vitest";
import {
  buildCourseSnapshot,
  createFormIssues,
  hasBlockingFindings,
  nextStep,
  reasonIssue,
  stepBlocker,
  validateCourseSnapshot,
  type RevisionLike,
  type SnapshotBlockSource,
  type SnapshotVersionSource,
} from "./governedContentRevision";

const version: SnapshotVersionSource = {
  id: "44000000-0000-4000-8000-000000000302",
  version_number: 2,
  title: "Medication administration",
  description: "Annual refresher",
  status: "published",
};

const block = (overrides: Partial<SnapshotBlockSource> = {}): SnapshotBlockSource => ({
  block_type: "text",
  sort_order: 0,
  title: "Introduction",
  body: { content: "Wash your hands" },
  video_url: null,
  document_id: null,
  ...overrides,
});

const revision = (overrides: Partial<RevisionLike> = {}): RevisionLike => ({
  id: "rev-1",
  asset_id: "asset-1",
  revision_number: 1,
  state: "draft",
  change_summary: "Clinical update",
  material_change: false,
  material_change_action: "none",
  snapshot_sha256: "a".repeat(64),
  authored_by: "author-1",
  reviewed_by: null,
  published_at: null,
  created_at: "2026-08-01T12:00:00Z",
  ...overrides,
});

describe("buildCourseSnapshot", () => {
  it("orders blocks by sort_order regardless of the order they arrived in", () => {
    const snapshot = buildCourseSnapshot(version, [
      block({ sort_order: 2, title: "Third" }),
      block({ sort_order: 0, title: "First" }),
      block({ sort_order: 1, title: "Second" }),
    ]);
    expect(snapshot.blocks.map((b) => b.title)).toEqual(["First", "Second", "Third"]);
  });

  it("is byte-identical for the same content, so an unchanged version hashes the same", () => {
    const blocks = [block({ sort_order: 1 }), block({ sort_order: 0, title: "Intro" })];
    const first = JSON.stringify(buildCourseSnapshot(version, blocks));
    const second = JSON.stringify(buildCourseSnapshot(version, [...blocks].reverse()));
    expect(first).toBe(second);
  });

  it("differs when the content differs, so a real edit cannot hash the same", () => {
    const before = JSON.stringify(buildCourseSnapshot(version, [block()]));
    const after = JSON.stringify(
      buildCourseSnapshot(version, [block({ body: { content: "Wash your hands twice" } })]),
    );
    expect(after).not.toBe(before);
  });

  it("normalises a missing title to an empty string rather than dropping the key", () => {
    const snapshot = buildCourseSnapshot({ ...version, title: null }, [block()]);
    expect(snapshot.title).toBe("");
    expect(Object.keys(snapshot)).toContain("title");
  });
});

describe("validateCourseSnapshot", () => {
  it("passes a published version with real blocks and an assessment", () => {
    const snapshot = buildCourseSnapshot(version, [
      block(),
      block({ block_type: "quiz", sort_order: 1, title: "Check", body: { questions: 4 } }),
    ]);
    expect(hasBlockingFindings(validateCourseSnapshot(snapshot))).toBe(false);
  });

  it("blocks a version with no content at all", () => {
    const findings = validateCourseSnapshot(buildCourseSnapshot(version, []));
    expect(findings.find((f) => f.code === "no_blocks")?.severity).toBe("error");
    expect(hasBlockingFindings(findings)).toBe(true);
  });

  it("blocks an untitled version", () => {
    const findings = validateCourseSnapshot(
      buildCourseSnapshot({ ...version, title: "   " }, [block()]),
    );
    expect(findings.some((f) => f.code === "title_missing" && f.severity === "error")).toBe(true);
  });

  it("names the positions of blocks that carry nothing", () => {
    const findings = validateCourseSnapshot(
      buildCourseSnapshot(version, [
        block(),
        block({ sort_order: 3, body: null }),
        block({ sort_order: 5, body: null }),
      ]),
    );
    const empty = findings.find((f) => f.code === "empty_blocks");
    expect(empty?.severity).toBe("error");
    expect(empty?.message).toContain("3, 5");
  });

  it("does not treat a video-only or document-only block as empty", () => {
    const findings = validateCourseSnapshot(
      buildCourseSnapshot(version, [
        block({ body: null, video_url: "https://example.test/v.mp4" }),
        block({ sort_order: 1, body: null, document_id: "doc-1" }),
      ]),
    );
    expect(findings.some((f) => f.code === "empty_blocks")).toBe(false);
  });

  it("warns about a missing assessment without blocking the submission", () => {
    const findings = validateCourseSnapshot(buildCourseSnapshot(version, [block()]));
    expect(findings.find((f) => f.code === "no_assessment")?.severity).toBe("warning");
    expect(hasBlockingFindings(findings)).toBe(false);
  });

  it("warns that a draft source will keep changing under the frozen snapshot", () => {
    const findings = validateCourseSnapshot(
      buildCourseSnapshot({ ...version, status: "draft" }, [block()]),
    );
    const finding = findings.find((f) => f.code === "source_unpublished");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("draft");
  });
});

describe("nextStep", () => {
  it("routes each editable state to the step the server will accept", () => {
    expect(nextStep("draft")).toBe("submit");
    expect(nextStep("changes_requested")).toBe("submit");
    expect(nextStep("in_review")).toBe("review");
    expect(nextStep("approved")).toBe("publish");
  });

  it("offers nothing on terminal states", () => {
    expect(nextStep("published")).toBe("none");
    expect(nextStep("superseded")).toBe("none");
    expect(nextStep("retired")).toBe("none");
  });
});

describe("stepBlocker", () => {
  it("lets the author submit their own draft", () => {
    expect(stepBlocker(revision(), "author-1")).toBeNull();
  });

  it("refuses a submission by anyone but the author", () => {
    expect(stepBlocker(revision(), "someone-else")).toMatch(/only the author/i);
  });

  it("refuses self-review, which is the whole point of the control", () => {
    expect(stepBlocker(revision({ state: "in_review" }), "author-1")).toMatch(/cannot review their own/i);
    expect(stepBlocker(revision({ state: "in_review" }), "reviewer-1")).toBeNull();
  });

  it("refuses self-publication too, separately from review", () => {
    const approved = revision({ state: "approved", reviewed_by: "reviewer-1" });
    expect(stepBlocker(approved, "author-1")).toMatch(/cannot publish their own/i);
    expect(stepBlocker(approved, "publisher-1")).toBeNull();
  });

  it("says a published revision is finished rather than blaming the viewer", () => {
    expect(stepBlocker(revision({ state: "published" }), "author-1")).toMatch(/no further step/i);
  });

  it("asks an anonymous viewer to sign in", () => {
    expect(stepBlocker(revision(), null)).toMatch(/sign in/i);
  });
});

describe("createFormIssues", () => {
  const base = {
    assetId: "asset-1",
    sourceVersionId: "version-1",
    changeSummary: "Updated the hand hygiene section",
    materialChange: false,
    materialChangeAction: "none",
  };

  it("accepts a complete form", () => {
    expect(createFormIssues(base)).toEqual([]);
  });

  it("requires the five-character summary the server requires", () => {
    expect(createFormIssues({ ...base, changeSummary: "typo" })).toHaveLength(1);
    expect(createFormIssues({ ...base, changeSummary: "typos" })).toEqual([]);
  });

  it("will not let a material change leave prior completers unaddressed", () => {
    expect(createFormIssues({ ...base, materialChange: true, materialChangeAction: "none" }))
      .toContainEqual(expect.stringMatching(/already completed/i));
    expect(createFormIssues({ ...base, materialChange: true, materialChangeAction: "reattest" }))
      .toEqual([]);
  });

  it("reports every missing field at once rather than one at a time", () => {
    expect(createFormIssues({ ...base, assetId: "", sourceVersionId: "", changeSummary: "" }))
      .toHaveLength(3);
  });
});

describe("reasonIssue", () => {
  it("matches the server's five-character floor", () => {
    expect(reasonIssue("okay", "review")).toMatch(/five characters/);
    expect(reasonIssue("     ", "review")).not.toBeNull();
    expect(reasonIssue("Reviewed against the 2800 regs", "review")).toBeNull();
  });
});
