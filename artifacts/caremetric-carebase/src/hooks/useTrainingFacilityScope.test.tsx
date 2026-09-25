import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trainingFacilityFromSearch } from "@/lib/trainingOnboarding";

const harness = vi.hoisted(() => ({
  role: "facility_manager",
  assignmentRead: { data: undefined as { facility_id: string }[] | undefined, isPending: true, isError: false, error: null as Error | null, refetch: vi.fn() },
  queryEnabled: undefined as boolean | undefined,
  directory: {
    data: [{ id: "unassigned-first", organization_id: "org-1" }, { id: "assigned-second", organization_id: "org-1" }],
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile-1", role: harness.role } }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: { enabled?: boolean }) => {
  harness.queryEnabled = options.enabled;
  return harness.assignmentRead;
} }));

import { useTrainingFacilityScope } from "./useFacilityAssignments";

let scope: ReturnType<typeof useTrainingFacilityScope<{ id: string; organization_id: string }>>;
function Probe({ requested = "assigned-second" }: { requested?: string }) {
  scope = useTrainingFacilityScope(harness.directory);
  const linked = trainingFacilityFromSearch(`source=train&facilityId=${requested}`, scope.facilities, "org-1");
  return <>{scope.isLoading ? "Loading" : scope.isError ? "Error" : linked ? `Ready ${linked.id}` : "Unavailable"}</>;
}

beforeEach(() => {
  harness.role = "facility_manager";
  harness.assignmentRead.data = undefined;
  harness.assignmentRead.isPending = true;
  harness.assignmentRead.isError = false;
  harness.assignmentRead.error = null;
  harness.directory.isLoading = false;
  harness.directory.refetch.mockClear();
  harness.assignmentRead.refetch.mockClear();
});

describe("training facility authorization readiness", () => {
  it("waits for a delayed manager assignment read after the directory has loaded", () => {
    expect(renderToStaticMarkup(<Probe />)).toBe("Loading");
    expect(scope.isReady).toBe(false);
    expect(scope.facilities).toEqual([]);
    expect(harness.queryEnabled).toBe(true);

    // The assignment response arrives after the org-wide directory response.
    harness.assignmentRead.data = [{ facility_id: "assigned-second" }];
    harness.assignmentRead.isPending = false;
    expect(renderToStaticMarkup(<Probe />)).toBe("Ready assigned-second");
    expect(scope.facilities.map(facility => facility.id)).toEqual(["assigned-second"]);
    expect(renderToStaticMarkup(<Probe requested="unassigned-first" />)).toBe("Unavailable");
  });

  it("restricts trainer reads to assigned facilities too, including an empty completed scope", () => {
    harness.role = "trainer";
    expect(renderToStaticMarkup(<Probe />)).toBe("Loading");
    harness.assignmentRead.data = [];
    harness.assignmentRead.isPending = false;
    expect(renderToStaticMarkup(<Probe />)).toBe("Unavailable");
    expect(scope.isReady).toBe(true);
    expect(scope.facilities).toEqual([]);
  });

  it("fails closed on assignment errors and retries the assignment read with the directory", () => {
    harness.assignmentRead.isPending = false;
    harness.assignmentRead.isError = true;
    harness.assignmentRead.error = new Error("Network unavailable");
    expect(renderToStaticMarkup(<Probe />)).toBe("Error");
    expect(scope.isReady).toBe(false);
    expect(scope.facilities).toEqual([]);
    scope.refetch();
    expect(harness.directory.refetch).toHaveBeenCalledOnce();
    expect(harness.assignmentRead.refetch).toHaveBeenCalledOnce();
  });

  it.each(["org_admin", "auditor"])("keeps the complete directory for %s without waiting on an unused assignment query", role => {
    harness.role = role;
    expect(renderToStaticMarkup(<Probe requested="unassigned-first" />)).toBe("Ready unassigned-first");
    expect(scope.facilities).toHaveLength(2);
    expect(harness.queryEnabled).toBe(false);
    harness.directory.isLoading = true;
    expect(renderToStaticMarkup(<Probe />)).toBe("Loading");
  });
});
