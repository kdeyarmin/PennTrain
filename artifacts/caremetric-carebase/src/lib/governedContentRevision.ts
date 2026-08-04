/**
 * Governed content revisions (BACKLOG.md G10).
 *
 * Migration `20260712023821` shipped a four-step publication control: author a revision, submit it,
 * have somebody else review it, have somebody else again publish it. Only step three had a caller.
 * `GovernedLearning.tsx` asked for a revision ID in a text box and offered approve/request-changes --
 * so the page reviewed revisions nothing could create, and an approved revision could never be
 * published. Three of the four steps were unreachable in production and exercised only by pgTAP.
 *
 * This module owns the reading of that lifecycle: what a snapshot is, what is wrong with one, and
 * which step a given revision is actually waiting on. Every rule here mirrors a check in the SQL --
 * they are restated so a person finds out at the keyboard rather than from a raised exception, not
 * to replace the server's enforcement, which stays the authority.
 */

export type RevisionState =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "published"
  | "retired"
  | "superseded";

export type MaterialChangeAction = "none" | "reassign" | "reattest" | "new_due_date";

export interface RevisionLike {
  id: string;
  asset_id: string;
  revision_number: number;
  state: string;
  change_summary: string;
  material_change: boolean;
  material_change_action: string;
  snapshot_sha256: string;
  authored_by: string;
  reviewed_by: string | null;
  published_at: string | null;
  created_at: string;
}

/** A block as the authoring tables store it, narrowed to what belongs in a governed snapshot. */
export interface SnapshotBlockSource {
  block_type: string;
  sort_order: number;
  title: string | null;
  body: unknown;
  video_url: string | null;
  document_id: string | null;
}

export interface SnapshotVersionSource {
  id: string;
  version_number: number;
  title: string | null;
  description: string | null;
  status: string;
}

export interface CourseSnapshot {
  kind: "course_version";
  courseVersionId: string;
  versionNumber: number;
  title: string;
  description: string | null;
  status: string;
  blocks: {
    blockType: string;
    sortOrder: number;
    title: string | null;
    body: unknown;
    videoUrl: string | null;
    documentId: string | null;
  }[];
}

/**
 * The exact content this revision claims to publish.
 *
 * The server hashes whatever it is handed and stores the digest as the immutable record of what was
 * approved, so this has to be *derived* from the authoring tables rather than typed by hand -- a
 * snapshot a human composed would attest to something nobody read. Key order is fixed and blocks are
 * sorted, so re-snapshotting an unchanged version produces a byte-identical object and therefore the
 * same `snapshot_sha256`: a reviewer can tell "nothing actually changed" from the hash alone.
 */
export function buildCourseSnapshot(
  version: SnapshotVersionSource,
  blocks: SnapshotBlockSource[],
): CourseSnapshot {
  return {
    kind: "course_version",
    courseVersionId: version.id,
    versionNumber: version.version_number,
    title: version.title ?? "",
    description: version.description ?? null,
    status: version.status,
    blocks: [...blocks]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((block) => ({
        blockType: block.block_type,
        sortOrder: block.sort_order,
        title: block.title ?? null,
        body: block.body ?? null,
        videoUrl: block.video_url ?? null,
        documentId: block.document_id ?? null,
      })),
  };
}

export interface ValidationFinding {
  code: string;
  severity: "error" | "warning";
  message: string;
}

/**
 * The validation results `submit_governed_content_revision` demands.
 *
 * The server's rule is narrow and precise: the argument must be a JSON array, and it refuses the
 * submission if any entry carries `severity: 'error'`. It does not care what the findings say. That
 * makes the array a *statement by the client about what it checked* -- so it has to be a real check,
 * not an empty array posted to satisfy a signature. These are the conditions under which content
 * genuinely should not go to an independent reviewer.
 */
export function validateCourseSnapshot(snapshot: CourseSnapshot): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!snapshot.title.trim()) {
    findings.push({ code: "title_missing", severity: "error", message: "The course version has no title." });
  }
  if (snapshot.blocks.length === 0) {
    findings.push({
      code: "no_blocks",
      severity: "error",
      message: "The course version has no content blocks — there is nothing to publish.",
    });
  }
  const emptyBlocks = snapshot.blocks.filter(
    (block) => block.body === null && !block.videoUrl && !block.documentId,
  );
  if (emptyBlocks.length > 0) {
    findings.push({
      code: "empty_blocks",
      severity: "error",
      message: `${emptyBlocks.length} block(s) carry no body, video or document (positions ${emptyBlocks
        .map((block) => block.sortOrder)
        .join(", ")}).`,
    });
  }
  if (!snapshot.blocks.some((block) => block.blockType === "quiz")) {
    findings.push({
      code: "no_assessment",
      severity: "warning",
      message: "No quiz block — completion will not be evidenced by an assessment.",
    });
  }
  if (snapshot.status !== "published") {
    findings.push({
      code: "source_unpublished",
      severity: "warning",
      message: `The source version is ${snapshot.status}; the governed snapshot will outlive further edits to it.`,
    });
  }
  return findings;
}

export function hasBlockingFindings(findings: ValidationFinding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}

export type RevisionStep = "submit" | "review" | "publish" | "none";

/** The one step this revision is waiting on, in the order the server enforces them. */
export function nextStep(state: string): RevisionStep {
  switch (state) {
    case "draft":
    case "changes_requested":
      return "submit";
    case "in_review":
      return "review";
    case "approved":
      return "publish";
    default:
      return "none";
  }
}

export function revisionStateLabel(state: string): string {
  switch (state) {
    case "draft": return "Draft";
    case "in_review": return "Awaiting independent review";
    case "changes_requested": return "Changes requested";
    case "approved": return "Approved, awaiting publication";
    case "published": return "Published";
    case "superseded": return "Superseded";
    case "retired": return "Retired";
    default: return state;
  }
}

/**
 * Why the viewer cannot take this revision's next step, or null when they can.
 *
 * Separation of duties is the substance of this control and the reason all three refusals exist:
 * `submit_` requires the author, `review_` and `publish_` both forbid them. Saying so up front is
 * the difference between "you are not the right person for this step" and a 42501 that reads like a
 * permissions bug.
 */
export function stepBlocker(revision: RevisionLike, viewerProfileId: string | null): string | null {
  const step = nextStep(revision.state);
  if (step === "none") {
    return `A ${revisionStateLabel(revision.state).toLowerCase()} revision has no further step.`;
  }
  if (!viewerProfileId) return "Sign in to act on this revision.";
  const isAuthor = revision.authored_by === viewerProfileId;
  if (step === "submit" && !isAuthor) {
    return "Only the author may submit this revision for review.";
  }
  if (step === "review" && isAuthor) {
    return "Authors cannot review their own revision — this needs a second person.";
  }
  if (step === "publish" && isAuthor) {
    return "Authors cannot publish their own revision — this needs a second person.";
  }
  return null;
}

/** What is wrong with a create form, or an empty list when it is ready to send. */
export function createFormIssues(input: {
  assetId: string;
  sourceVersionId: string;
  changeSummary: string;
  materialChange: boolean;
  materialChangeAction: string;
}): string[] {
  const issues: string[] = [];
  if (!input.assetId) issues.push("Choose the governed asset this revision belongs to.");
  if (!input.sourceVersionId) issues.push("Choose the source version to snapshot.");
  // Mirrors `length(btrim(coalesce(p_change_summary,''))) < 5` in create_governed_content_revision.
  if (input.changeSummary.trim().length < 5) {
    issues.push("Describe the change in at least five characters — it is stored with the snapshot.");
  }
  // Mirrors the table's `check (not material_change or material_change_action <> 'none')`.
  if (input.materialChange && input.materialChangeAction === "none") {
    issues.push("A material change has to say what happens to people who already completed it.");
  }
  return issues;
}

/** Mirrors `length(btrim(coalesce(p_reason,''))) < 5` shared by review_ and publish_. */
export function reasonIssue(reason: string, what: string): string | null {
  return reason.trim().length < 5
    ? `Give a reason of at least five characters — it is stored as the ${what} record.`
    : null;
}

export const MATERIAL_CHANGE_ACTION_LABELS: Record<MaterialChangeAction, string> = {
  none: "No action — cosmetic change only",
  reassign: "Reassign the course to everyone who holds it",
  reattest: "Require re-attestation from prior completers",
  new_due_date: "Issue a new due date to prior completers",
};
