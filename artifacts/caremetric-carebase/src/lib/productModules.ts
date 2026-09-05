import type { Role } from "@/lib/auth";

export const PRODUCT_MODULES = [
  {
    id: "train",
    entitlementKey: "modules.train",
    name: "CareMetric Train",
    shortName: "Train",
    description: "Online courses, assignments, learning plans, training records, and certificates.",
  },
  {
    id: "workforce",
    entitlementKey: "modules.workforce",
    name: "CareMetric Workforce",
    shortName: "Workforce",
    description: "Credentialing, competencies, background and exclusion screening, scheduling, and practicums.",
  },
  {
    id: "compliance",
    entitlementKey: "modules.compliance",
    name: "CareMetric Compliance",
    shortName: "Compliance",
    description: "Inspection readiness, survey day, violations, complaints, incident reporting, state forms, evidence, QAPI, and policies.",
  },
  {
    id: "billing",
    entitlementKey: "modules.billing",
    name: "CareMetric Billing",
    shortName: "Billing",
    description: "Resident financial operations: rate agreements, statements, receivables aging, payments, and personal funds.",
  },
  {
    id: "carebase",
    entitlementKey: "modules.carebase",
    name: "CareMetric CareBase",
    shortName: "CareBase",
    description:
      "The complete resident care operations suite. Includes Train, Workforce, Compliance, and Billing.",
  },
] as const;

export type ProductModuleId = "core" | (typeof PRODUCT_MODULES)[number]["id"];
export type PurchasableProductModuleId = Exclude<ProductModuleId, "core">;

export const ALL_PRODUCT_MODULE_IDS: readonly ProductModuleId[] = [
  "core",
  "train",
  "workforce",
  "compliance",
  "billing",
  "carebase",
];
export const ALL_PURCHASABLE_PRODUCT_MODULE_IDS: readonly PurchasableProductModuleId[] = [
  "train",
  "workforce",
  "compliance",
  "billing",
  "carebase",
];

// Buying the full CareBase suite grants every operational pillar. Keeping this dependency here (and
// mirrored in the database `has_product_module` function) means existing CareBase customers retain
// access to every route even though the pillars are now separately entitled.
const CAREBASE_INCLUDED_MODULES: readonly PurchasableProductModuleId[] = [
  "train",
  "workforce",
  "compliance",
  "billing",
];

const INTERNAL_APP_PREFIXES = ["/account", "/admin", "/app", "/trainer", "/me"] as const;

// Directory, tenant administration, account security, and support are the shared shell. They are
// deliberately available in a Train-only facility because an administrator still needs to manage
// facilities, learners, users, branding, and support without purchasing CareBase.
//
// Note: the resident-management routes (/app/residents*) intentionally stay CareBase below. Only the
// resident *directory table* is shared core at the database layer (see the migration) so Compliance-
// and Billing-tier pages can join resident context; that data-layer decision does not make the
// resident routes core.
// Exported so route-manifest coverage tests can verify these classifier entries reference real
// App.tsx routes -- see routeRegistration.test.ts. ("/account" is the one intentional exception:
// a route-tree prefix for the shared /account/* pages rather than a page of its own.)
export const CORE_PATHS = [
  "/account",
  "/admin",
  "/app/facilities",
  "/app/employees",
  "/app/users",
  "/app/settings",
  "/app/help",
  // Billing is core on purpose: the day a trial lapses, get_effective_entitlements returns
  // is_entitled=false for every module and ProtectedRoute redirects any non-core path to the home
  // path. If this page is not core, the "trial ended -- choose a plan" screen, the checkout button
  // and the T-7/T-1 notice links all become unreachable at exactly the moment they exist for.
  "/app/billing",
  "/trainer/facilities",
  "/trainer/employees",
  "/me/help",
] as const;

export const TRAIN_PATHS = [
  "/app/training-matrix",
  "/app/training-types",
  "/app/courses",
  "/app/course-assignments",
  "/app/training-plans",
  "/app/governed-learning",
  "/app/pending-approvals",
  "/app/my-trainings",
  "/trainer",
  "/trainer/gaps",
  "/me/courses",
  "/me/trainings",
  "/me/certificates",
] as const;

// Staff credentialing, competency, screening, scheduling, and practicum operations.
export const WORKFORCE_PATHS = [
  "/app/credentials",
  "/app/competency-records",
  "/app/competency-templates",
  "/app/background-checks",
  "/app/exclusion-screening",
  "/app/administrator-qualification",
  "/app/practicums",
  "/app/med-admin-roster",
  "/app/schedule",
  "/app/shift-handoffs",
  "/app/shift-log",
  "/app/workforce-operations",
  "/app/my-schedule",
  "/me/credentials",
  "/me/schedule",
  "/me/shift",
] as const;

// Regulatory readiness: inspections, survey day, violations, complaints, forms, evidence, QAPI,
// policies, and the regulatory copilot.
export const COMPLIANCE_PATHS = [
  "/app/compliance-command-center",
  "/app/inspections",
  "/app/inspection-readiness",
  "/app/survey-day",
  "/app/violations",
  "/app/complaints",
  "/app/report-event",
  "/app/state-forms",
  "/app/dhs-forms",
  "/app/evidence",
  "/app/qapi",
  "/app/policies",
  "/app/policy-documents",
  "/app/regulatory-copilot",
  "/app/regulatory-crosswalk",
  "/app/compliance-binder",
  "/app/resident-compliance",
  "/app/closed-loop-compliance",
  "/me/attestations",
  "/app/my-attestations",
] as const;
// "/attestations" is deliberately absent. It sits outside INTERNAL_APP_PREFIXES, so
// productModuleForPath returns null before any of these lists are consulted -- an entry here would
// be dead code that reads like a rule. It is a pure redirect; the Compliance gate applies at
// whichever of the two paths above it lands on.

// Resident financial operations.
export const BILLING_PATHS = ["/app/resident-finance"] as const;

function stripPathSuffix(path: string): string {
  return path.match(/^([^?#]*)/)?.[1] || "/";
}

function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Resolve every protected application route to exactly one commercial module.
 * Public/marketing paths return null and continue to use their existing public-access rules.
 */
export function productModuleForPath(path: string): ProductModuleId | null {
  const pathname = stripPathSuffix(path);
  if (!INTERNAL_APP_PREFIXES.some((prefix) => matchesPath(pathname, prefix))) return null;
  if (CORE_PATHS.some((prefix) => matchesPath(pathname, prefix))) return "core";
  if (TRAIN_PATHS.some((prefix) => matchesPath(pathname, prefix))) return "train";
  if (WORKFORCE_PATHS.some((prefix) => matchesPath(pathname, prefix))) return "workforce";
  if (COMPLIANCE_PATHS.some((prefix) => matchesPath(pathname, prefix))) return "compliance";
  if (BILLING_PATHS.some((prefix) => matchesPath(pathname, prefix))) return "billing";

  // Employee and trainer landing pages belong to Train. CareBase-only users are not a supported
  // commercial combination because CareBase contractually includes Train.
  if (pathname === "/me" || pathname === "/trainer") return "train";

  // All remaining authenticated product routes are the full CareBase care-operations application.
  return "carebase";
}

export function withModuleDependencies(
  modules: Iterable<ProductModuleId>,
): ReadonlySet<ProductModuleId> {
  const resolved = new Set<ProductModuleId>(["core", ...modules]);
  if (resolved.has("carebase")) {
    for (const included of CAREBASE_INCLUDED_MODULES) resolved.add(included);
  }
  return resolved;
}

export function canAccessProductPath(path: string, enabledModules: ReadonlySet<ProductModuleId>): boolean {
  const moduleId = productModuleForPath(path);
  return moduleId === null || enabledModules.has(moduleId);
}

export function moduleHomePathForRole(
  role: Role | undefined,
  enabledModules: ReadonlySet<ProductModuleId>,
): string | null {
  if (!role) return null;
  if (role === "platform_admin") return "/admin";
  if (role === "trainer") return enabledModules.has("train") ? "/trainer" : "/app/help";
  if (role === "employee") {
    if (enabledModules.has("carebase")) return "/me";
    if (enabledModules.has("train")) return "/me/courses";
    if (enabledModules.has("workforce")) return "/me/schedule";
    return "/me/help";
  }
  if (enabledModules.has("carebase")) return "/app/today";
  if (enabledModules.has("train")) return "/app/training-matrix";
  if (enabledModules.has("compliance")) return "/app/inspection-readiness";
  if (enabledModules.has("workforce")) return "/app/credentials";
  if (enabledModules.has("billing")) return "/app/resident-finance";
  return "/app/help";
}

export function parseBuildProductModules(value: string | undefined): ReadonlySet<ProductModuleId> {
  if (!value?.trim()) return withModuleDependencies(ALL_PRODUCT_MODULE_IDS);
  const requested = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ProductModuleId => ALL_PRODUCT_MODULE_IDS.includes(item as ProductModuleId));
  if (requested.length === 0) return withModuleDependencies(ALL_PRODUCT_MODULE_IDS);
  return withModuleDependencies(requested);
}

export function moduleDefinition(id: PurchasableProductModuleId) {
  return PRODUCT_MODULES.find((module) => module.id === id)!;
}

/**
 * Whether an entitlement-RPC failure should take the app down to a full-page retry.
 *
 * Only when there is nothing to serve. The access provider already falls back to the last-good
 * module set on a transient failure, so reporting every failure as blocking made that fallback
 * unreachable: the screen it existed to prevent was rendered instead, on any blip, for every
 * signed-in user at once. A failure on the FIRST load has no last-good behind it, and there the
 * error screen is the honest answer rather than silently degrading a paying tenant to core-only.
 */
export function entitlementFailureIsBlocking(state: {
  isError: boolean;
  hasLastGoodModules: boolean;
}): boolean {
  return state.isError && !state.hasLastGoodModules;
}
