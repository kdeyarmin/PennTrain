import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  escapeLikePattern,
  evaluateScimRoleGuard,
  type GovernedProfile,
  SQL_GOVERNED_ROLES,
  UNREACHABLE_ROLE,
} from "./roleGuard.ts";

function profile(
  role: string,
  resolution: GovernedProfile["resolution"],
  isActive = true,
): GovernedProfile {
  return { id: `p-${role}-${resolution}`, role, is_active: isActive, resolution };
}

Deno.test("a platform administrator is untouchable on every operation", () => {
  // No scim_group_mappings.app_role can be 'platform_admin', so every write onto such a profile is
  // one the directory never asserted -- including a suspend, which would deactivate the login.
  for (const operation of ["create", "update", "suspend", "deprovision"] as const) {
    for (const resolution of ["email_match", "employee_link"] as const) {
      const verdict = evaluateScimRoleGuard({
        operation,
        assertedRole: "employee",
        candidates: [profile(UNREACHABLE_ROLE, resolution)],
      });
      assertEquals(verdict.allowed, false, `${operation}/${resolution}`);
      assertEquals(verdict.errorCode, "scim_would_write_platform_admin");
    }
  }
});

Deno.test("an unasserted fallback does not flatten a non-admin matched by email alone", () => {
  // The defect one role down from the org_admin case the SQL now handles: no mapping matched, so
  // apply_scim_change's coalesce writes 'employee' onto a profile SCIM never provisioned.
  for (const role of ["facility_manager", "trainer", "auditor"]) {
    const verdict = evaluateScimRoleGuard({
      operation: "update",
      assertedRole: null,
      candidates: [profile(role, "email_match")],
    });
    assertEquals(verdict.allowed, false, role);
    assertEquals(verdict.errorCode, "scim_role_not_asserted", role);
  }
});

Deno.test("a mapping that names a role is an assertion, so it passes", () => {
  // "By an email match alone" is the rule. With a group mapping the directory has said something,
  // and the tenant configured that mapping deliberately.
  assertEquals(
    evaluateScimRoleGuard({
      operation: "update",
      assertedRole: "employee",
      candidates: [profile("facility_manager", "email_match")],
    }).allowed,
    true,
  );
});

Deno.test("org_admin is left to apply_scim_change, which declines rather than errors", () => {
  // 20260906190000 records "role unchanged: ..." on the response and carries on, deliberately,
  // because a SCIM connector retries a 500 for ever. Refusing here would convert that answer into
  // a failure.
  assertEquals(SQL_GOVERNED_ROLES.includes("org_admin"), true);
  for (const operation of ["create", "update", "suspend", "deprovision"] as const) {
    assertEquals(
      evaluateScimRoleGuard({
        operation,
        assertedRole: null,
        candidates: [profile("org_admin", "email_match")],
      }).allowed,
      true,
      operation,
    );
  }
});

Deno.test("an email match whose role would not change is left alone", () => {
  // Name, email and facility still sync; only an unasserted ROLE write is refused, so ordinary
  // directory maintenance on an already-correct profile is untouched.
  assertEquals(
    evaluateScimRoleGuard({
      operation: "update",
      assertedRole: null,
      candidates: [profile("employee", "email_match")],
    }).allowed,
    true,
  );
});

Deno.test("a login SCIM provisioned keeps the mapped-role and employee fallback", () => {
  // The employee-row link means the directory created this login. Demoting it to 'employee' when
  // its group mapping is removed is a directory doing its job, not the defect.
  assertEquals(
    evaluateScimRoleGuard({
      operation: "update",
      assertedRole: null,
      candidates: [profile("facility_manager", "employee_link")],
    }).allowed,
    true,
  );
});

Deno.test("the employee link outranks a stray email match, as the resolver's coalesce does", () => {
  assertEquals(
    evaluateScimRoleGuard({
      operation: "update",
      assertedRole: null,
      candidates: [profile("auditor", "email_match"), profile("employee", "employee_link")],
    }).allowed,
    true,
  );
});

Deno.test("every duplicate-email candidate is judged, not just the first", () => {
  // With duplicate emails the resolver's own ordering picks the target, so all of them are judged.
  const verdict = evaluateScimRoleGuard({
    operation: "create",
    assertedRole: null,
    candidates: [profile("employee", "email_match"), profile("trainer", "email_match")],
  });
  assertEquals(verdict.allowed, false);
  assertEquals(verdict.errorCode, "scim_role_not_asserted");
});

Deno.test("suspend and deprovision are only guarded for the unreachable role", () => {
  // Deactivating the last org_admin is refused by apply_scim_change itself, and every other
  // deactivation is an ordinary directory action.
  for (const role of ["employee", "facility_manager", "trainer", "auditor", "org_admin"]) {
    assertEquals(
      evaluateScimRoleGuard({
        operation: "deprovision",
        assertedRole: null,
        candidates: [profile(role, "email_match")],
      }).allowed,
      true,
      role,
    );
  }
});

Deno.test("a subject that resolves to nothing is a clean create", () => {
  for (const operation of ["create", "update", "suspend", "deprovision"] as const) {
    assertEquals(
      evaluateScimRoleGuard({
        operation,
        assertedRole: "employee",
        candidates: [],
      }).allowed,
      true,
      operation,
    );
  }
});

// BACKLOG J93. The candidate query truncates before the exact comparison is redone in memory, so a
// pattern that matches many rows can hide the very profile this guard protects. `_` and `%` are the
// realistic ones and are escaped; `*` cannot be, because PostgREST rewrites it to `%` without
// honouring a backslash (verified against the running stack), which is why the call site refuses a
// full page rather than filtering it.
Deno.test("escapeLikePattern neutralises the SQL wildcards", () => {
  assertEquals(escapeLikePattern("a_min@x.com"), "a\\_min@x.com");
  assertEquals(escapeLikePattern("%@x.com"), "\\%@x.com");
  assertEquals(escapeLikePattern("a%b_c@x.com"), "a\\%b\\_c@x.com");
  assertEquals(escapeLikePattern("plain@x.com"), "plain@x.com");
});

Deno.test("escapeLikePattern escapes the escape character before the wildcards", () => {
  // A lone backslash must not become the escape for whatever follows it.
  assertEquals(escapeLikePattern("back\\slash@x.com"), "back\\\\slash@x.com");
  assertEquals(escapeLikePattern("a\\_b@x.com"), "a\\\\\\_b@x.com");
});

Deno.test("escapeLikePattern leaves PostgREST's own wildcard alone", () => {
  // Deliberate: escaping it produces `\%`, a literal percent sign, and the address stops matching
  // altogether. A guard that silently matches nothing is worse than one that over-matches, and the
  // over-match is caught by the full-page refusal at the call site.
  assertEquals(escapeLikePattern("a*b@x.com"), "a*b@x.com");
});
