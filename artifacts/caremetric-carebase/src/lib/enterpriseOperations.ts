export interface EnterpriseMetricDefinition {
  key: string;
  numerator: string;
  denominator: string;
  dateBasis: string;
  source: string;
}

export interface GuidedSetupItem {
  key: string;
  label: string;
  complete: boolean;
  why: string;
}

export function summarizeSetupProgress(items: GuidedSetupItem[]) {
  const total = items.length;
  const complete = items.filter((item) => item.complete).length;
  return {
    total,
    complete,
    remaining: Math.max(total - complete, 0),
    percent: total === 0 ? 0 : Math.round((complete / total) * 100),
  };
}

export function metricHasSafeDenominator(metric: { denominator?: unknown }) {
  return typeof metric.denominator !== "number" || metric.denominator >= 1;
}

export const ENTERPRISE_OPERATION_GUARDRAILS = [
  "Provider secrets stay in managed backend configuration and are never returned to React.",
  "Entitlements, rollout cohorts, release flags, and kill switches are tracked separately from authorization.",
  "Historical executive snapshots are immutable evidence; live summaries are safely recomputable.",
  "Import previews must reconcile rows before active records are changed.",
] as const;
