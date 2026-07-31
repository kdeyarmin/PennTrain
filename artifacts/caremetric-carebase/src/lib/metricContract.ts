/**
 * Cross-surface metric contract.
 *
 * Home (`/app/today`) already defines operational counts in `homeMetrics.ts`.
 * Dashboard (`/app`) shows training-compliance counts plus open/critical alerts.
 * This module is the single place that:
 *   1. Re-exports Home definitions (so consumers import one contract module).
 *   2. Registers Dashboard-only training metrics with explicit definitions.
 *   3. Asserts that shared concepts (critical alerts, open alerts) use ONE label
 *      and ONE definition text no matter which surface renders them.
 *
 * Adding a number to any manager home surface without registering it here is how
 * "Critical alerts" once meant org-wide on Dashboard and facility-scoped on Today
 * with neither card saying which. Do not reintroduce that.
 */

import {
  HOME_METRIC_DEFINITIONS,
  homeMetricDefinition,
  type HomeMetricDefinition,
} from "./homeMetrics";

export {
  HOME_METRIC_DEFINITIONS,
  homeMetricDefinition,
  buildHomeMetrics,
  firstCall,
  highlightMetrics,
  type HomeMetric,
  type HomeMetricDefinition,
  type HomeMetricInput,
} from "./homeMetrics";

export type DashboardMetricKey =
  | "compliant_requirements"
  | "due_within_30_days"
  | "due_within_90_days"
  | "expired_requirements"
  | "trainers_needing_recert"
  | "recent_uploads"
  | "open_alerts"
  | "critical_alerts"
  | "active_staff"
  | "med_admin_staff";

export interface DashboardMetricDefinition {
  key: DashboardMetricKey;
  label: string;
  definition: string;
  href: string;
  /** When true, this key must match the Home metric of the same key exactly. */
  sharesHomeDefinition?: boolean;
}

/**
 * Dashboard training + staffing metrics. Alert keys deliberately share Home definitions.
 */
export const DASHBOARD_METRIC_DEFINITIONS: DashboardMetricDefinition[] = [
  {
    key: "compliant_requirements",
    label: "Compliant Requirements",
    definition:
      "Training and practicum requirements (across all facilities the caller can see) that currently meet compliance status.",
    href: "/app/training-matrix?statusFilter=compliant",
  },
  {
    key: "due_within_30_days",
    label: "Due Within 30 Days",
    definition: "Training and practicum requirements with a due date in the next 30 days.",
    href: "/app/training-matrix?dueWindow=30",
  },
  {
    key: "due_within_90_days",
    label: "Due Within 90 Days",
    definition:
      "Training and practicum requirements with a due date in the next 90 days — includes items already counted in Due Within 30 Days.",
    href: "/app/training-matrix?dueWindow=90",
  },
  {
    key: "expired_requirements",
    label: "Expired Requirements",
    definition: "Training and practicum requirements that are past their due date and have not been renewed.",
    href: "/app/training-matrix?statusFilter=expired",
  },
  {
    key: "trainers_needing_recert",
    label: "Trainers Needing Recertification",
    definition:
      "Active staff marked as trainers who have at least one training requirement that is due soon or expired.",
    href: "/app/training-matrix?trainerOnly=true",
  },
  {
    key: "recent_uploads",
    label: "Recent Uploads",
    definition: "Training documents uploaded in the last 14 days.",
    href: "/app/documents",
  },
  {
    key: "active_staff",
    label: "Active Staff",
    definition: "Employees with status active in the caller's organization scope.",
    href: "/app/employees?status=active",
  },
  {
    key: "med_admin_staff",
    label: "Med Admin",
    definition: "Active staff flagged as medication administrators.",
    href: "/app/med-admin-roster",
  },
  // Shared with Home — definitions come from homeMetrics; labels must match.
  {
    key: "open_alerts",
    label: "Open alerts",
    definition: homeMetricDefinition("open_alerts")!.definition,
    href: homeMetricDefinition("open_alerts")!.href,
    sharesHomeDefinition: true,
  },
  {
    key: "critical_alerts",
    label: "Critical alerts",
    definition: homeMetricDefinition("critical_alerts")!.definition,
    href: homeMetricDefinition("critical_alerts")!.href,
    sharesHomeDefinition: true,
  },
];

const DASHBOARD_BY_KEY = new Map(DASHBOARD_METRIC_DEFINITIONS.map((d) => [d.key, d]));

export function dashboardMetricDefinition(key: DashboardMetricKey): DashboardMetricDefinition | undefined {
  return DASHBOARD_BY_KEY.get(key);
}

/**
 * Returns shared-concept collisions (same key registered on Home and Dashboard with
 * divergent label or definition). Empty array means the contract holds.
 */
export function findMetricContractViolations(
  home: HomeMetricDefinition[] = HOME_METRIC_DEFINITIONS,
  dashboard: DashboardMetricDefinition[] = DASHBOARD_METRIC_DEFINITIONS,
): string[] {
  const violations: string[] = [];
  const homeByKey = new Map(home.map((m) => [m.key, m]));

  for (const dash of dashboard) {
    if (!dash.sharesHomeDefinition) continue;
    const homeMetric = homeByKey.get(dash.key);
    if (!homeMetric) {
      violations.push(`Dashboard metric "${dash.key}" claims to share Home but Home has no such key`);
      continue;
    }
    // Labels may differ only in capitalization of the first letter; normalize.
    if (homeMetric.label.toLowerCase() !== dash.label.toLowerCase()) {
      violations.push(
        `Label mismatch for "${dash.key}": Home="${homeMetric.label}" Dashboard="${dash.label}"`,
      );
    }
    if (homeMetric.definition !== dash.definition) {
      violations.push(
        `Definition mismatch for "${dash.key}": Home and Dashboard disagree`,
      );
    }
    if (homeMetric.href !== dash.href) {
      violations.push(
        `Href mismatch for "${dash.key}": Home="${homeMetric.href}" Dashboard="${dash.href}"`,
      );
    }
  }

  // Duplicate keys inside each registry.
  const homeKeys = home.map((m) => m.key);
  if (new Set(homeKeys).size !== homeKeys.length) {
    violations.push("Home metric keys are not unique");
  }
  const dashKeys = dashboard.map((m) => m.key);
  if (new Set(dashKeys).size !== dashKeys.length) {
    violations.push("Dashboard metric keys are not unique");
  }

  return violations;
}

/** Human-readable scope note for Dashboard (always org-wide under RLS). */
export const DASHBOARD_SCOPE_LABEL = "all facilities you can access";
