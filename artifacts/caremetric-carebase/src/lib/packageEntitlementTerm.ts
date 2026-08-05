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

export type FeatureValueType = "boolean" | "integer" | "decimal" | "string" | "json";

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

/** What is wrong with the term, or an empty list when the server will accept it. */
export function entitlementTermIssues(form: EntitlementTermForm, now: Date): string[] {
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
  // Mirrors the server's own refusal: a current term that already starts at or after the new one
  // means the new term does not supersede it, it collides with it.
  if (!Number.isNaN(from) && from < now.getTime() - 86_400_000) {
    issues.push("A term cannot be backdated more than a day — supersede the current one going forward instead.");
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
