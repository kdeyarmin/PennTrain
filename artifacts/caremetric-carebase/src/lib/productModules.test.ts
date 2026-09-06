import { describe, expect, it } from "vitest";
import {
  canAccessProductPath,
  entitlementFailureIsBlocking,
  lastGoodModulesForOrganization,
  moduleHomePathForRole,
  parseBuildProductModules,
  productModuleForPath,
  withModuleDependencies,
} from "./productModules";

describe("product module routing", () => {
  it("classifies shared, Train, and Care Operations routes", () => {
    expect(productModuleForPath("/app/employees/employee-id")).toBe("core");
    expect(productModuleForPath("/app/courses/course-id")).toBe("train");
    expect(productModuleForPath("/me/courses/assignment-id/quiz/quiz-id")).toBe("train");
    expect(productModuleForPath("/app/residents/resident-id")).toBe("carebase");
    expect(productModuleForPath("/app/resident-care-delivery")).toBe("carebase");
    expect(productModuleForPath("/features")).toBeNull();
  });

  it("classifies the carved Workforce, Compliance, and Billing pillars", () => {
    expect(productModuleForPath("/app/credentials")).toBe("workforce");
    expect(productModuleForPath("/app/schedule/setup")).toBe("workforce");
    expect(productModuleForPath("/me/schedule")).toBe("workforce");
    expect(productModuleForPath("/app/inspection-readiness")).toBe("compliance");
    expect(productModuleForPath("/app/state-forms?status=due")).toBe("compliance");
    expect(productModuleForPath("/app/violations/violation-id")).toBe("compliance");
    expect(productModuleForPath("/me/attestations")).toBe("compliance");
    expect(productModuleForPath("/app/resident-finance")).toBe("billing");
  });

  // The route classifier and the database's table-to-module map have to agree: the database accepts
  // a write the router refuses, or refuses one the router allows, wherever they disagree. These are
  // the routes that used to fall through to CareBase while their primary table was classified to a
  // pillar -- the incident register above all, which is what the Compliance pillar is sold as.
  it("classifies each route by the module that owns its primary table", () => {
    // incidents / incident_notifications -> modules.compliance
    expect(productModuleForPath("/app/incidents")).toBe("compliance");
    expect(productModuleForPath("/app/incidents/incident-id")).toBe("compliance");
    expect(productModuleForPath("/app/incidents?action=add")).toBe("compliance");
    // evidence_guest_grants -> modules.compliance
    expect(productModuleForPath("/app/guest-access")).toBe("compliance");
    // survey rehearsals are mock surveys, classified with the rest of survey readiness
    expect(productModuleForPath("/app/survey-rehearsals")).toBe("compliance");
    // training_documents -> modules.train, and Train-only /app/pending-approvals depends on it
    expect(productModuleForPath("/app/documents")).toBe("train");
    expect(productModuleForPath("/me/documents")).toBe("train");
    // Deliberately NOT moved: their tables are classified modules.carebase.
    expect(productModuleForPath("/app/confidential-incidents")).toBe("carebase");
    expect(productModuleForPath("/app/work")).toBe("carebase");
  });

  it("gives a Compliance package the incident register it is sold as", () => {
    // "Report an event" is already a Compliance path; every destination it offers that the database
    // would accept a write for has to be reachable, or the chooser bounces off ProtectedRoute.
    const essentials = withModuleDependencies(["train", "compliance"]);
    expect(canAccessProductPath("/app/report-event", essentials)).toBe(true);
    expect(canAccessProductPath("/app/incidents", essentials)).toBe(true);
    expect(canAccessProductPath("/app/incidents/incident-id", essentials)).toBe(true);
    expect(canAccessProductPath("/app/complaints", essentials)).toBe(true);
    expect(canAccessProductPath("/app/guest-access", essentials)).toBe(true);
    expect(canAccessProductPath("/app/survey-rehearsals", essentials)).toBe(true);
    expect(canAccessProductPath("/app/documents", essentials)).toBe(true);
    // A Workforce-only package still owns none of them.
    const workforceOnly = withModuleDependencies(["workforce"]);
    expect(canAccessProductPath("/app/incidents", workforceOnly)).toBe(false);
    expect(canAccessProductPath("/app/guest-access", workforceOnly)).toBe(false);
    expect(canAccessProductPath("/app/documents", workforceOnly)).toBe(false);
  });

  it("keeps the billing page reachable after a trial lapses", () => {
    // A lapsed trial leaves an organization with core routes only; the page that sells a plan
    // must be one of them or the lockout has no exit.
    expect(productModuleForPath("/app/billing")).toBe("core");
    expect(productModuleForPath("/app/billing?plan=carebase")).toBe("core");
  });

  it("makes CareBase include every operational pillar", () => {
    expect([...withModuleDependencies(["carebase"])]).toEqual([
      "core",
      "carebase",
      "train",
      "workforce",
      "compliance",
      "billing",
    ]);
    expect([...parseBuildProductModules("carebase")]).toEqual([
      "core",
      "carebase",
      "train",
      "workforce",
      "compliance",
      "billing",
    ]);
  });

  it("keeps a Train-only facility out of pillar routes", () => {
    const trainOnly = withModuleDependencies(["train"]);
    expect(canAccessProductPath("/app/training-matrix", trainOnly)).toBe(true);
    expect(canAccessProductPath("/app/employees", trainOnly)).toBe(true);
    expect(canAccessProductPath("/app/residents", trainOnly)).toBe(false);
    expect(canAccessProductPath("/app/credentials", trainOnly)).toBe(false);
    expect(canAccessProductPath("/app/inspection-readiness", trainOnly)).toBe(false);
    expect(canAccessProductPath("/app/resident-finance", trainOnly)).toBe(false);
    expect(moduleHomePathForRole("org_admin", trainOnly)).toBe("/app/training-matrix");
    expect(moduleHomePathForRole("employee", trainOnly)).toBe("/me/courses");
  });

  it("scopes a Compliance pillar package to its own routes", () => {
    const essentials = withModuleDependencies(["train", "compliance"]);
    expect(canAccessProductPath("/app/inspection-readiness", essentials)).toBe(true);
    expect(canAccessProductPath("/app/state-forms", essentials)).toBe(true);
    expect(canAccessProductPath("/app/credentials", essentials)).toBe(false);
    expect(canAccessProductPath("/app/resident-finance", essentials)).toBe(false);
    expect(canAccessProductPath("/app/residents", essentials)).toBe(false);
    expect(moduleHomePathForRole("org_admin", withModuleDependencies(["compliance"]))).toBe(
      "/app/inspection-readiness",
    );
  });

  it("lands users on role-specific start pages in a CareBase organization", () => {
    const allModules = withModuleDependencies(["carebase"]);
    expect(moduleHomePathForRole("org_admin", allModules)).toBe("/app/today");
    expect(moduleHomePathForRole("facility_manager", allModules)).toBe("/app/today");
    expect(moduleHomePathForRole("auditor", allModules)).toBe("/app/today");
    expect(moduleHomePathForRole("employee", allModules)).toBe("/me");
  });
});

describe("entitlementFailureIsBlocking", () => {
  // The access provider keeps a last-good module set precisely so a transient entitlement RPC
  // failure does not strip a paying tenant back to core-only. Reporting every failure as blocking
  // rendered a full-page retry instead, which made that fallback unreachable.
  it("serves the last-good modules through a transient failure", () => {
    expect(entitlementFailureIsBlocking({ isError: true, hasLastGoodModules: true })).toBe(false);
  });

  it("blocks when the first load failed and there is nothing to serve", () => {
    expect(entitlementFailureIsBlocking({ isError: true, hasLastGoodModules: false })).toBe(true);
  });

  it("never blocks without an error", () => {
    expect(entitlementFailureIsBlocking({ isError: false, hasLastGoodModules: false })).toBe(false);
    expect(entitlementFailureIsBlocking({ isError: false, hasLastGoodModules: true })).toBe(false);
  });
});

describe("lastGoodModulesForOrganization", () => {
  const modules = new Set(["carebase"]) as ReadonlySet<never>;
  const cached = { organizationId: "org-a", modules } as never;

  it("serves the cached set back to the organization it was computed for", () => {
    expect(lastGoodModulesForOrganization(cached, "org-a")).toBe(modules);
  });

  // The ref outlives what a sign-out clears. Without the key, the second tenant to sign in on one
  // mounted SPA inherited the first tenant's modules the moment their own entitlement call failed --
  // and because a last-good set "existed", entitlementFailureIsBlocking suppressed the error screen
  // that would have stopped them. Routes and navigation for modules they do not own.
  it("refuses it to a different organization", () => {
    expect(lastGoodModulesForOrganization(cached, "org-b")).toBeNull();
  });

  it("refuses it when there is no organization in scope yet", () => {
    expect(lastGoodModulesForOrganization(cached, null)).toBeNull();
    expect(lastGoodModulesForOrganization(cached, undefined)).toBeNull();
  });

  it("has nothing to serve before a first success", () => {
    expect(lastGoodModulesForOrganization(null, "org-a")).toBeNull();
  });
});
