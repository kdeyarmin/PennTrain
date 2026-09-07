/**
 * The two SCIM writes that `apply_scim_change` still cannot refuse for itself (BACKLOG.md J22).
 *
 * WHAT THE DEFECT IS. `apply_scim_change` picks the role for an incoming subject as
 * `coalesce(v_mapping.app_role, 'employee')` and writes it onto whatever profile the subject
 * resolves to -- and `app_private.resolve_scim_link_profile_id`
 * (`20260724233000_scim_subject_link_profile_revocation.sql:26-72`) resolves through three arms:
 * the invite-provisioned `employees.profile_id`, then an SSO-linked same-organization profile whose
 * email equals the SCIM userName, then ANY same-organization profile with that email. The last two
 * are an email match and nothing more, so a directory push carrying somebody's address re-roles
 * their login whether or not the payload said anything about their role.
 *
 * WHAT IS ALREADY FIXED IN SQL, AND IS NOT DUPLICATED HERE.
 * `20260906190000_a_directory_push_that_demoted_the_founder.sql` taught `apply_scim_change` the
 * distinction between a mapped role and the `employee` fallback: it will not lower an `org_admin`
 * on the fallback, and never demotes or deactivates the last active `org_admin` at all. It records
 * both as `declined` on the response rather than raising, deliberately -- "a connector retries a
 * 500 for ever" -- so this module must not turn those same cases into errors. It does not.
 *
 * WHAT IS LEFT, and is what this refuses, ahead of the RPC so nothing partial is written:
 *
 *   1. `platform_admin`. The SQL rules are written about `org_admin` only, and
 *      `scim_group_mappings.app_role` cannot be `platform_admin`
 *      (`20260711200637_phase2_regulatory_rules_and_identity.sql:354-355`) -- so no payload can
 *      ever assert that role, and every SCIM write touching such a profile is by construction
 *      unasserted. A tenant's directory has no business re-roling or deactivating a platform
 *      operator at all.
 *   2. A NON-ADMIN role rewritten on an email match with nothing asserting it. When no group
 *      mapping matches, the fallback flattens a `facility_manager`, `trainer` or `auditor` to
 *      `employee` -- on a profile SCIM never provisioned, found only because it shares an address.
 *      The SQL's protection stops at `org_admin`, so this is the same defect one role down.
 *
 * A subject SCIM genuinely owns -- its employee row carries the profile -- keeps the existing
 * behaviour, mapped role and `employee` fallback included, because that is a directory managing a
 * login the directory created.
 */

export type ScimOperation = "create" | "update" | "suspend" | "deprovision";

/** How `resolve_scim_link_profile_id` would have found this profile. */
export type ProfileResolution =
  /** Arm 1: `employees.profile_id` on the subject's own employee row. SCIM owns this login. */
  | "employee_link"
  /** Arms 2 and 3: a same-organization profile that merely shares the SCIM userName. */
  | "email_match"
  /**
   * The coalesce's LAST arm: `scim_subject_links.profile_id`, the profile this subject was
   * recorded against when it still resolved. `apply_scim_change` keeps it deliberately -- "a
   * resolution miss never clears a previously recorded profile (the link keeps its revocation
   * target even if the employee row was unlinked later)" -- so it is a profile SCIM can still act
   * on after both other arms have gone quiet.
   */
  | "link_fallback";

export interface GovernedProfile {
  id: string;
  role: string;
  is_active: boolean;
  resolution: ProfileResolution;
}

export interface ScimRoleGuardInput {
  operation: ScimOperation;
  /**
   * The role the payload ACTUALLY asserts: the `app_role` of the highest-priority
   * `scim_group_mappings` row matching the payload's groups, or null when the payload asserted no
   * group this connection maps. Null is not `'employee'` -- that conflation is the defect.
   */
  assertedRole: string | null;
  /** Every profile `apply_scim_change` could resolve for this subject. Empty means a clean create. */
  candidates: GovernedProfile[];
}

export interface ScimRoleGuardVerdict {
  allowed: boolean;
  errorCode?: string;
  message?: string;
}

/** The role no SCIM payload can assert, and which SCIM therefore may never write over. */
export const UNREACHABLE_ROLE = "platform_admin";

/**
 * Roles whose demotion `apply_scim_change` decides for itself (20260906190000), so this module
 * leaves them alone rather than converting a recorded decline into a connector-visible error.
 */
export const SQL_GOVERNED_ROLES: readonly string[] = ["org_admin"];

const ALLOWED: ScimRoleGuardVerdict = { allowed: true };

function deny(errorCode: string, message: string): ScimRoleGuardVerdict {
  return { allowed: false, errorCode, message };
}

export function evaluateScimRoleGuard(input: ScimRoleGuardInput): ScimRoleGuardVerdict {
  // Deterministic, and shaped like the coalesce it stands in for. The employee-row link is the
  // authoritative target when it exists. Otherwise every email match is judged, because with
  // duplicate emails the resolver's own ordering decides which login gets written and a guard that
  // inspected only one of them would have a hole exactly the width of the case it exists to stop.
  //
  // The persisted link profile is the LAST arm, and it is judged only when the two above it are
  // empty -- which is exactly when `apply_scim_change` falls back to it (BACKLOG J94). Leaving it
  // out meant that a subject whose employee row had been detached and whose email no longer
  // matched produced NO candidates at all, this guard allowed the write, and the RPC then
  // suspended or deprovisioned the recorded profile unjudged: a profile that may since have been
  // promoted to platform_admin, which is the one role no SCIM payload can even assert.
  const linked = input.candidates.find((candidate) => candidate.resolution === "employee_link");
  const emailMatches = input.candidates.filter((candidate) => candidate.resolution === "email_match");
  const judged = linked
    ? [linked]
    : emailMatches.length > 0
      ? emailMatches
      : input.candidates.filter((candidate) => candidate.resolution === "link_fallback");

  for (const profile of judged) {
    if (profile.role === UNREACHABLE_ROLE) {
      return deny(
        "scim_would_write_platform_admin",
        "This subject resolves to a platform administrator's profile. No SCIM group mapping can " +
          "assert that role, so any change to it would be one the directory never claimed; " +
          "manage platform operators in the platform console.",
      );
    }
    if (input.operation === "suspend" || input.operation === "deprovision") continue;
    // The unasserted-role rule is about a profile found ONLY because it shares an address. The
    // persisted link profile is not that: SCIM was governing it, and the link still names it. It
    // is judged here for the platform_admin rule above, which is what the fallback path can reach.
    if (
      profile.resolution === "email_match" &&
      input.assertedRole === null &&
      profile.role !== "employee" &&
      !SQL_GOVERNED_ROLES.includes(profile.role)
    ) {
      return deny(
        "scim_role_not_asserted",
        `This subject matches an existing ${profile.role} profile by email only, and no group in ` +
          "the payload maps to a role. SCIM will not fall back to employee on a profile it did " +
          "not provision: map the group that should govern this person, or link the employee record.",
      );
    }
  }
  return ALLOWED;
}

/**
 * A LIKE/ILIKE pattern that matches `value` and nothing else -- as far as this transport allows.
 *
 * `%` and `_` are SQL wildcards and are escaped, backslash first because it is the escape character
 * itself. `*` is deliberately NOT escaped: it is PostgREST's own wildcard, rewritten to `%` on the
 * way through, and the rewrite does not respect a preceding backslash. Verified against the local
 * stack rather than reasoned about -- `email=ilike.a\*b@x.com` returns nothing at all, because what
 * reaches Postgres is `a\%b`, a literal percent sign. So a `*` in an address cannot be expressed
 * here, and escaping it would turn a rare over-match into a guaranteed miss, which for a guard is
 * the worse failure.
 *
 * The residual widening is handled where it matters, at the call site: a full page of candidates
 * means the set may be incomplete, and an incomplete set is refused rather than filtered.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
