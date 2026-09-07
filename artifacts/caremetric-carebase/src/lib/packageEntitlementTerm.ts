/**
 * Effective-dated package entitlement terms (BACKLOG.md G11).
 *
 * The Packages editor writes `packages.features`, and an `ingest_legacy_package_contract` trigger
 * copies that into `package_entitlements` -- so the ordinary path already works, and this function
 * is not a broken link. What it adds is the two things the trigger cannot express, because the
 * trigger always writes "effective now, no end, source legacy_backfill":
 *
 *   - a term that starts in the future or ends on a date, so a contracted change can be scheduled
 *     rather than applied by somebody remembering to click a checkbox on the right morning; and
 *   - a `contract_reference`, so a non-standard entitlement is traceable to the agreement that
 *     bought it instead of looking like an unexplained deviation from the package.
 *
 * The value is JSON because `feature_definitions.value_type` allows boolean, integer, decimal,
 * string and json -- a limit like `limits.learners` is a number, not a switch.
 */

import { facilityDateOf } from "./dateUtils";

export type FeatureValueType = "boolean" | "integer" | "decimal" | "string" | "json";

/**
 * One currently-open term on the package, as `usePackageEntitlements` maps it: `effective_to is
 * null`, `effective_from` an instant. Only the two columns the server's collision test reads.
 */
export interface OpenEntitlementTerm {
  featureKey: string;
  effectiveFromAt: string;
}

export interface EntitlementTermForm {
  packageId: string;
  featureKey: string;
  /** Raw text as typed; parsed against the feature's declared value type. */
  rawValue: string;
  valueType: FeatureValueType;
  reason: string;
  effectiveFrom: string;
  effectiveTo: string;
  contractReference: string;
}

export interface ParsedValue {
  ok: boolean;
  value: unknown;
  error: string | null;
}

/** Parse the typed value against what `feature_definitions` says the feature holds. */
export function parseEntitlementValue(raw: string, valueType: FeatureValueType): ParsedValue {
  const text = raw.trim();
  if (!text) return { ok: false, value: null, error: "Give the value this package should grant." };
  switch (valueType) {
    case "boolean": {
      if (text === "true") return { ok: true, value: true, error: null };
      if (text === "false") return { ok: true, value: false, error: null };
      return { ok: false, value: null, error: "A boolean feature is either true or false." };
    }
    case "integer": {
      if (!/^-?\d+$/.test(text)) {
        return { ok: false, value: null, error: "This feature holds a whole number." };
      }
      return { ok: true, value: Number(text), error: null };
    }
    case "decimal": {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        return { ok: false, value: null, error: "This feature holds a number." };
      }
      return { ok: true, value: parsed, error: null };
    }
    case "string":
      return { ok: true, value: text, error: null };
    case "json": {
      try {
        return { ok: true, value: JSON.parse(text), error: null };
      } catch {
        return { ok: false, value: null, error: "This feature holds a JSON document, and that is not valid JSON." };
      }
    }
    default:
      return { ok: false, value: null, error: `Unknown value type ${valueType}.` };
  }
}

/**
 * What is wrong with the term, or an empty list when the server will accept it.
 *
 * `openTerms` is the package's currently-open terms -- `undefined` while that query has not
 * answered. The collision rule below is the only one that needs them, and it is skipped when they
 * are unknown: the server tests it too, so an unknown-terms submit gets a refusal with the server's
 * own message, whereas guessing a collision would disable the button over a term that may not
 * exist. This is the opposite trade-off from a write that destroys data on a wrong guess -- here
 * the wrong guess costs a round trip, and blocking costs the operation.
 */
export function entitlementTermIssues(
  form: EntitlementTermForm,
  openTerms: readonly OpenEntitlementTerm[] | undefined,
): string[] {
  const issues: string[] = [];
  if (!form.packageId) issues.push("Choose the package this term applies to.");
  if (!form.featureKey) issues.push("Choose the feature.");
  const parsed = parseEntitlementValue(form.rawValue, form.valueType);
  if (parsed.error) issues.push(parsed.error);
  // Mirrors `if nullif(trim(p_reason), '') is null then raise exception 'Change reason required'`.
  if (!form.reason.trim()) {
    issues.push("Give a reason — it is stored as the audit reason for the change.");
  }
  const from = Date.parse(form.effectiveFrom);
  if (!form.effectiveFrom || Number.isNaN(from)) {
    issues.push("Give the date the term starts.");
  }
  if (form.effectiveTo) {
    const to = Date.parse(form.effectiveTo);
    if (Number.isNaN(to)) issues.push("Give a valid end date, or leave it open-ended.");
    // Mirrors `check (effective_to is null or effective_to > effective_from)`.
    else if (!Number.isNaN(from) && to <= from) issues.push("The term has to end after it starts.");
  }
  // Mirrors `set_package_entitlement`'s own refusal, which is about the CURRENT TERM's start and
  // not about today:
  //
  //     if exists (select 1 from public.package_entitlements e
  //                where e.package_id = p_package_id and e.feature_key = p_feature_key
  //                  and e.effective_to is null and e.effective_from >= p_effective_from)
  //     then raise exception 'New package term must start after the current term';
  //
  // It is per FEATURE, not per package: an open term on `modules.billing` says nothing about a new
  // term on `limits.learners`. And it is not a ban on backdating -- the RPC closes the current term
  // at `p_effective_from`, so a term backdated to after that term started is exactly the supersede
  // it is for, and a feature with no open term at all can be backdated freely. That matters for the
  // real reason a term is entered late: a contract signed weeks ago being recorded now.
  if (!Number.isNaN(from) && openTerms && form.featureKey) {
    const collision = openTerms.find(
      (term) => term.featureKey === form.featureKey && Date.parse(term.effectiveFromAt) >= from,
    );
    if (collision) {
      const started = facilityDateOf(collision.effectiveFromAt);
      issues.push(
        `${form.featureKey} already has an open term starting ${started ?? "on an unreadable date"}` +
          " — a new term has to start after that one, so it supersedes rather than collides with it.",
      );
    }
  }
  return issues;
}

/** How this term reads once saved, in the sentence somebody reviewing the package would want. */
export function termSummary(form: EntitlementTermForm, now: Date): string {
  const parsed = parseEntitlementValue(form.rawValue, form.valueType);
  const value = parsed.ok ? JSON.stringify(parsed.value) : "?";
  const from = Date.parse(form.effectiveFrom);
  const when = Number.isNaN(from)
    ? "from an unset date"
    : from <= now.getTime()
      ? "immediately"
      : `from ${new Date(from).toLocaleDateString()}`;
  const until = form.effectiveTo && !Number.isNaN(Date.parse(form.effectiveTo))
    ? ` until ${new Date(form.effectiveTo).toLocaleDateString()}`
    : " with no end date";
  return `${form.featureKey || "This feature"} becomes ${value} ${when}${until}.`;
}
