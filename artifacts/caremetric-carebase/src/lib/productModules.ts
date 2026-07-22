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
    id: "carebase",
    entitlementKey: "modules.carebase",
    name: "CareMetric CareBase",
    shortName: "CareBase",
    description: "The complete resident, workforce, forms, operations, compliance, and reporting suite. Includes CareMetric Train.",
  },
] as const;

export type ProductModuleId = "core" | (typeof PRODUCT_MODULES)[number]["id"];
export type PurchasableProductModuleId = Exclude<ProductModuleId, "core">;

export const ALL_PRODUCT_MODULE_IDS: readonly ProductModuleId[] = ["core", "train", "carebase"];
export const ALL_PURCHASABLE_PRODUCT_MODULE_IDS: readonly PurchasableProductModuleId[] = ["train", "carebase"];

const INTERNAL_APP_PREFIXES = ["/account", "/admin", "/app", "/trainer", "/me"] as const;

// Directory, tenant administration, account security, and support are the shared shell. They are
// deliberately available in a Train-only facility because an administrator still needs to manage
// facilities, learners, users, branding, and support without purchasing CareBase.
const CORE_PATHS = [
  "/account",
  "/admin",
  "/app/facilities",
  "/app/employees",
  "/app/users",
  "/app/settings",
  "/app/help",
  "/trainer/facilities",
  "/trainer/employees",
  "/me/help",
] as const;

const TRAIN_PATHS = [
  "/app/training-matrix",
  "/app/training-types",
  "/app/courses",
  "/app/course-assignments",
  "/app/training-plans",
  "/app/governed-learning",
  "/app/pending-approvals",
  "/trainer",
  "/me/courses",
  "/me/trainings",
  "/me/certificates",
] as const;

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

  // Employee and trainer landing pages belong to Train. CareBase-only users are not a supported
  // commercial combination because CareBase contractually includes Train.
  if (pathname === "/me" || pathname === "/trainer") return "train";

  // All remaining authenticated product routes are the full CareBase operational application.
  return "carebase";
}

export function withModuleDependencies(
  modules: Iterable<ProductModuleId>,
): ReadonlySet<ProductModuleId> {
  const resolved = new Set<ProductModuleId>(["core", ...modules]);
  if (resolved.has("carebase")) resolved.add("train");
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
    return "/me/help";
  }
  if (enabledModules.has("carebase")) return "/app/today";
  if (enabledModules.has("train")) return "/app/training-matrix";
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
