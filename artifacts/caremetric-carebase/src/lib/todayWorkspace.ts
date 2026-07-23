export interface DueWorkItem {
  state: string;
  due_at: string;
}

const CLOSED_WORK_STATES = new Set(["closed", "canceled"]);

export function summarizeDueWork<T extends DueWorkItem>(
  items: T[],
  now = Date.now(),
  visibleLimit = 8,
) {
  const activeItems = items.filter((item) => !CLOSED_WORK_STATES.has(item.state));
  const overdueCount = activeItems.filter((item) => {
    const dueAt = Date.parse(item.due_at);
    return Number.isFinite(dueAt) && dueAt < now;
  }).length;

  return {
    activeItems,
    visibleItems: activeItems.slice(0, visibleLimit),
    totalCount: activeItems.length,
    overdueCount,
    upcomingCount: Math.max(activeItems.length - overdueCount, 0),
  };
}

export interface TodayDestinations {
  primary: { href: string; label: string };
  handoffs: string;
  coverage: string;
  inspection: string;
  residentAndMedication: string;
}

/**
 * Today is shared by managers and auditors, but several operational workspaces are
 * manager-only. Keep every call to action inside the signed-in role's route surface
 * instead of relying on ProtectedRoute to bounce an auditor back to the dashboard.
 */
export function getTodayDestinations(role: string | undefined): TodayDestinations {
  if (role === "auditor") {
    return {
      primary: { href: "/app/evidence", label: "Open Documentation Room" },
      handoffs: "/app/audit",
      coverage: "/app/reports",
      inspection: "/app/evidence",
      residentAndMedication: "/app/reports",
    };
  }

  return {
    primary: { href: "/app/value-center", label: "Open Value Center" },
    handoffs: "/app/shift-handoffs",
    coverage: "/app/schedule",
    inspection: "/app/value-center",
    residentAndMedication: "/app/value-center",
  };
}
