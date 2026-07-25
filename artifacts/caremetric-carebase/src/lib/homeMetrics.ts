/**
 * Home surface metric definitions (program plan Phase 7b, request item 16).
 *
 * THE EXIT GATE THIS EXISTS FOR: "no metric appears on more than one surface with two different
 * definitions". Divergent definitions are how the current Dashboard/Today/Alerts duplication became
 * a problem, and two concrete divergences were found before this module was written:
 *
 *   1. "Critical alerts". Dashboard reads `alerts.criticalCount` from the org dashboard summary --
 *      org-wide, open, severity critical. Today counts `severity === 'critical'` over the alerts it
 *      fetched for the *selected facility*. Same label, different scope, neither stating which.
 *   2. "Due work". Today's card counts active work items due within seven days. The Work queue's
 *      summary counts all active items regardless of due date. Same word, different sets.
 *
 * (A third was checked and found to already agree: "overdue" means `state not in (closed, canceled)
 * and due_at < now` in both `get_work_item_queue` and `summarizeDueWork`. It is left alone.)
 *
 * So every Home metric is defined once, here, with its scope and its window written down and shown
 * in the UI. `definition` is not documentation for developers -- it is rendered on the card, because
 * a number whose definition is invisible is a number two people will read differently.
 *
 * NOTHING HERE IS A SCORE. Every value is a count of records that exist, consistent with the
 * program-wide constraint against composite risk numbers.
 */

export type MetricScope = "facility_or_portfolio" | "portfolio_only";

export interface HomeMetricDefinition {
  key: string;
  label: string;
  /** The rule, in the words someone would use defending the number. Rendered in the UI. */
  definition: string;
  scope: MetricScope;
  /** Where clicking the metric goes. */
  href: string;
  /** True when a non-zero value means somebody should act today. */
  urgentWhenPositive: boolean;
}

/**
 * The registry. Adding a metric here and rendering it from `buildHomeMetrics` is the only supported
 * way to put a number on Home, which is what keeps the definitions single.
 */
export const HOME_METRIC_DEFINITIONS: HomeMetricDefinition[] = [
  {
    key: "overdue_work",
    label: "Overdue work",
    definition: "Work items not closed or cancelled whose due date has passed. Identical to the Work queue's overdue count.",
    scope: "facility_or_portfolio",
    href: "/app/work?due=overdue",
    urgentWhenPositive: true,
  },
  {
    key: "due_today",
    label: "Due today",
    definition: "Work items not closed or cancelled whose due date falls before the end of today.",
    scope: "facility_or_portfolio",
    href: "/app/work",
    urgentWhenPositive: true,
  },
  {
    key: "due_this_week",
    label: "Due within seven days",
    definition: "Work items not closed or cancelled due in the next seven days, including those already overdue.",
    scope: "facility_or_portfolio",
    href: "/app/work",
    urgentWhenPositive: false,
  },
  {
    key: "urgent_work",
    label: "Urgent work",
    definition: "Open work items marked urgent, whatever their due date.",
    scope: "facility_or_portfolio",
    href: "/app/work?priority=urgent",
    urgentWhenPositive: true,
  },
  {
    key: "critical_alerts",
    label: "Critical alerts",
    definition: "Alerts with status open and severity critical, in the current scope.",
    scope: "facility_or_portfolio",
    href: "/app/alerts",
    urgentWhenPositive: true,
  },
  {
    key: "open_alerts",
    label: "Open alerts",
    definition: "Alerts with status open, any severity, in the current scope.",
    scope: "facility_or_portfolio",
    href: "/app/alerts",
    urgentWhenPositive: false,
  },
  {
    key: "unfilled_shifts",
    label: "Coverage gaps",
    definition: "Unfilled shifts after a call-off that are still open.",
    scope: "facility_or_portfolio",
    href: "/app/schedule",
    urgentWhenPositive: true,
  },
  {
    key: "open_handoffs",
    label: "Open handoffs",
    definition: "Shift report entries still open or carried forward.",
    scope: "facility_or_portfolio",
    href: "/app/shift-handoffs",
    urgentWhenPositive: false,
  },
];

const BY_KEY = new Map(HOME_METRIC_DEFINITIONS.map((entry) => [entry.key, entry]));

export function homeMetricDefinition(key: string): HomeMetricDefinition | undefined {
  return BY_KEY.get(key);
}

export interface HomeWorkItemLike {
  state: string;
  priority: string;
  due_at: string;
  source_type: string;
}

export interface HomeAlertLike {
  status: string;
  severity: string;
}

export interface HomeMetricInput {
  workItems: HomeWorkItemLike[];
  alerts: HomeAlertLike[];
  unfilledShifts: number;
  openHandoffs: number;
  /** Null when viewing the whole portfolio. Drives the scope label on every card. */
  facilityName: string | null;
  now?: Date;
}

export interface HomeMetric extends HomeMetricDefinition {
  value: number;
  /** The scope this particular reading covers, spelled out. */
  scopeLabel: string;
  urgent: boolean;
}

/** Work states that mean the item is no longer somebody's to do. Matches `get_work_item_queue`. */
const CLOSED_STATES = new Set(["closed", "canceled"]);

function endOfToday(now: Date): number {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

export function buildHomeMetrics(input: HomeMetricInput): HomeMetric[] {
  const now = input.now ?? new Date();
  const scopeLabel = input.facilityName ?? "all permitted facilities";

  const active = input.workItems.filter((item) => !CLOSED_STATES.has(item.state));
  const dueAt = (item: HomeWorkItemLike) => Date.parse(item.due_at);

  const overdue = active.filter((item) => {
    const due = dueAt(item);
    return Number.isFinite(due) && due < now.getTime();
  }).length;
  const dueToday = active.filter((item) => {
    const due = dueAt(item);
    return Number.isFinite(due) && due <= endOfToday(now);
  }).length;
  const dueThisWeek = active.filter((item) => {
    const due = dueAt(item);
    return Number.isFinite(due) && due <= now.getTime() + 7 * 86_400_000;
  }).length;
  const urgent = active.filter((item) => item.priority === "urgent").length;

  const openAlerts = input.alerts.filter((alert) => alert.status === "open");
  const criticalAlerts = openAlerts.filter((alert) => alert.severity === "critical").length;

  const values: Record<string, number> = {
    overdue_work: overdue,
    due_today: dueToday,
    due_this_week: dueThisWeek,
    urgent_work: urgent,
    critical_alerts: criticalAlerts,
    open_alerts: openAlerts.length,
    unfilled_shifts: input.unfilledShifts,
    open_handoffs: input.openHandoffs,
  };

  return HOME_METRIC_DEFINITIONS.map((definition) => ({
    ...definition,
    value: values[definition.key] ?? 0,
    scopeLabel,
    urgent: definition.urgentWhenPositive && (values[definition.key] ?? 0) > 0,
  }));
}

/**
 * The single next thing to look at, or null when nothing is outstanding. Deliberately the *first*
 * urgent metric in registry order rather than the largest number: an ordering by size would put a
 * pile of routine work ahead of one uncovered shift.
 */
export function firstCall(metrics: HomeMetric[]): HomeMetric | null {
  return metrics.find((metric) => metric.urgent) ?? null;
}

/** Metrics worth showing at all: a zero that is not urgent is noise on a page meant to be scanned. */
export function highlightMetrics(metrics: HomeMetric[]): HomeMetric[] {
  return metrics.filter((metric) => metric.value > 0 || metric.urgentWhenPositive);
}
