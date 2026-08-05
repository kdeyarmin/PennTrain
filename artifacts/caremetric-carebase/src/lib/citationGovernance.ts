/**
 * How a citation is allowed to appear in front of a user (Phase 10b, request item 24b).
 *
 * THE PROBLEM. `dhs_citation_topics` was seeded with refs like "2600.65 / 2800.69" whose own notes
 * column says the section numbers are approximate and must be verified. The readiness page rendered
 * them as bare parenthetical citations. A facility reading "(2600.65)" off a screen has no way to
 * know whether anyone ever checked it, and the program plan names a confidently-wrong citation in a
 * survey packet as this product's worst failure mode.
 *
 * THE RULE. An unverified citation is never displayed as though it were verified. It is shown --
 * hiding it would lose information the operator has -- but always with the qualifier attached, so
 * the uncertainty travels with the number instead of being stripped off at the UI boundary.
 */

export type CitationVerificationStatus = "verified" | "unverified" | "approximate" | "superseded";

/** Matches `v_reverify_days` in 20260726200000_citation_verification_governance.sql. */
export const CITATION_REVERIFICATION_INTERVAL_DAYS = 365;

export interface CitationLike {
  citation_ref: string | null;
  verification_status: string;
  verified_on?: string | null;
  superseded_by_ref?: string | null;
}

export interface CitationDisplay {
  /** The reference itself, or null when there is nothing to show. */
  text: string | null;
  /** Short qualifier shown next to the reference. Null only when the citation is verified and current. */
  qualifier: string | null;
  /** Longer explanation for a tooltip or help text. */
  detail: string | null;
  /** Whether a surface should treat this as trustworthy enough to put in front of a surveyor. */
  citable: boolean;
}

function isStale(verifiedOn: string | null | undefined, today: Date): boolean {
  if (!verifiedOn) return false;
  const verified = new Date(`${verifiedOn}T00:00:00`);
  if (Number.isNaN(verified.valueOf())) return false;
  const days = Math.floor((today.valueOf() - verified.valueOf()) / 86_400_000);
  return days > CITATION_REVERIFICATION_INTERVAL_DAYS;
}

export function citationDisplay(topic: CitationLike, today: Date = new Date()): CitationDisplay {
  if (!topic.citation_ref) {
    return { text: null, qualifier: null, detail: null, citable: false };
  }

  switch (topic.verification_status) {
    case "verified":
      if (isStale(topic.verified_on, today)) {
        return {
          text: topic.citation_ref,
          qualifier: "verification overdue",
          detail:
            `Last verified ${topic.verified_on}. Citations are re-checked every `
            + `${CITATION_REVERIFICATION_INTERVAL_DAYS} days; confirm against the current regulation `
            + `before relying on it.`,
          // Deliberately not citable. A citation verified once and never re-checked is exactly how a
          // superseded section number stays in a product for years.
          citable: false,
        };
      }
      return { text: topic.citation_ref, qualifier: null, detail: null, citable: true };

    case "approximate":
      return {
        text: topic.citation_ref,
        qualifier: "approximate",
        detail:
          "This section number was recorded as approximate and has not been checked against the "
          + "regulation. Confirm it before quoting it to a surveyor.",
        citable: false,
      };

    case "superseded":
      return {
        text: topic.citation_ref,
        qualifier: topic.superseded_by_ref ? `superseded by ${topic.superseded_by_ref}` : "superseded",
        detail:
          topic.superseded_by_ref
            ? `This citation has been replaced by ${topic.superseded_by_ref}.`
            : "This citation has been replaced.",
        citable: false,
      };

    // Anything unrecognised is treated as unverified rather than trusted. A status this code does
    // not know about is not a reason to assume the best.
    default:
      return {
        text: topic.citation_ref,
        qualifier: "unverified",
        detail:
          "Nobody has recorded checking this citation against the regulation. Confirm it before "
          + "quoting it to a surveyor.",
        citable: false,
      };
  }
}

/**
 * What is wrong with a verification a person is about to record, in their words.
 *
 * `record_citation_verification` refuses a verification with no source URL, and a CHECK on the table
 * independently refuses `'verified'` without a verifier, a date, **and** a source. That is the right
 * server behaviour and a bad first experience: the operator finds out by submitting. This states the
 * same rules up front, and the server still enforces them -- these are the two halves of one
 * decision, not a client-side gate.
 *
 * Empty array means "nothing wrong that this form can see".
 */
export function verificationFormIssues(input: {
  citationRef: string;
  sourceUrl: string;
  verifiedOn: string;
  today?: Date;
}): string[] {
  const issues: string[] = [];
  if (!input.citationRef.trim()) {
    issues.push("Enter the section number exactly as it appears in the regulation.");
  }
  const source = input.sourceUrl.trim();
  if (!source) {
    // The whole point of the mechanism: a verification nobody can retrace is a claim, not evidence.
    issues.push("A source URL is required — a verification nobody can retrace is not evidence.");
  } else if (!/^https?:\/\/\S+$/u.test(source)) {
    issues.push("The source must be a URL, so the next person can open what you read.");
  }
  if (input.verifiedOn) {
    const verified = new Date(`${input.verifiedOn}T00:00:00`);
    if (Number.isNaN(verified.valueOf())) {
      issues.push("Verification date is not a real date.");
    } else if (verified.valueOf() > (input.today ?? new Date()).valueOf()) {
      issues.push("Verification date cannot be in the future.");
    }
  }
  return issues;
}

/** Same, for recording that a citation has been replaced. */
export function supersessionFormIssues(input: { supersededByRef: string }): string[] {
  // A supersession with no successor loses the only thing that makes it actionable: where to look
  // instead. The table's CHECK refuses it too.
  return input.supersededByRef.trim()
    ? []
    : ["Name the section that replaces this one — 'superseded' with no successor tells nobody where to look."];
}

/** Formats a reference for inline display, e.g. "(2600.65 — approximate)". */
export function inlineCitation(topic: CitationLike, today: Date = new Date()): string {
  const display = citationDisplay(topic, today);
  if (!display.text) return "";
  return display.qualifier ? ` (${display.text} — ${display.qualifier})` : ` (${display.text})`;
}
