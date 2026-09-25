import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canAccessProductPath, withModuleDependencies } from "@/lib/productModules";

const harness = vi.hoisted(() => ({
  fullSuite: false,
  reads: new Map<string, boolean>(),
  employee: { id: "student-1", organization_id: "org-1", facility_id: "facility-1", first_name: "Taylor", last_name: "Learner", email: "taylor@example.test", job_title: "Direct care", hire_date: "2026-01-01", status: "active", worker_type: "regular", profile_id: null, cleared_for_unsupervised_duty: false },
  facility: { id: "facility-1", organization_id: "org-1", name: "Training Facility", facility_type: "PCH", state: "PA", is_active: true },
  query: (name: string, enabled = true, data: unknown = []) => {
    harness.reads.set(name, enabled);
    return { data, isLoading: false, isError: false, refetch: vi.fn() };
  },
  mutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("wouter", () => ({ useParams: () => ({ id: "student-1" }), useLocation: () => ["/app/employees/student-1", vi.fn()], Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "admin-1", role: "org_admin", organizationId: "org-1" } }) }));
vi.mock("@/lib/productModuleAccess", () => ({ useProductModuleAccess: () => ({ canAccessPath: (path: string) => canAccessProductPath(path, withModuleDependencies([harness.fullSuite ? "carebase" : "train"])) }) }));
vi.mock("@/lib/pageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useFacilities", () => ({ useGetFacility: () => harness.query("facility", true, harness.facility), useListFacilities: () => harness.query("facilities", true, [harness.facility]), useUpdateFacility: harness.mutation }));
vi.mock("@/hooks/useEmployees", () => ({ useGetEmployee: () => harness.query("employee", true, harness.employee), useListEmployees: () => harness.query("employees", true, [harness.employee]), useUpdateEmployee: harness.mutation }));
vi.mock("@/hooks/useTrainingRecords", () => ({ useListTrainingRecords: () => harness.query("training records"), useCreateTrainingRecord: harness.mutation, useUpdateTrainingRecord: harness.mutation }));
vi.mock("@/hooks/useTrainingTypes", () => ({ useListTrainingTypes: () => harness.query("training types") }));
vi.mock("@/hooks/usePracticums", () => ({ useListPracticums: (_filters: unknown, options?: { enabled?: boolean }) => harness.query("practicums", options?.enabled) }));
vi.mock("@/hooks/useTrainingHourBuckets", () => ({ useListTrainingHourBuckets: () => harness.query("training hours"), useListCourseCompletionCredits: () => harness.query("course credits") }));
vi.mock("@/hooks/useDocuments", () => ({ useListDocuments: () => harness.query("documents"), useDocumentSignedUrl: harness.mutation }));
vi.mock("@/hooks/useEmployeeCredentials", () => ({ useListEmployeeCredentials: (_filters: unknown, options?: { enabled?: boolean }) => harness.query("credentials", options?.enabled), useEmployeeRequiredItems: (id?: string) => harness.query("duty requirements", !!id) }));
vi.mock("@/hooks/useEmployeeFacilityAssignments", () => ({ useListEmployeeFacilityAssignments: (_filters: unknown, options?: { enabled?: boolean }) => harness.query("schedule facility assignments", options?.enabled), useAddEmployeeFacilityAssignment: harness.mutation, useRemoveEmployeeFacilityAssignment: harness.mutation }));
vi.mock("@/hooks/useOnboarding", () => ({ useListEmployeeOnboardingItems: (id?: string) => harness.query("workforce onboarding", !!id), useListEmployeeCheckinLogs: (id?: string) => harness.query("retention", !!id), useUpdateEmployeeOnboardingItem: harness.mutation, useLogEmployeeCheckin: harness.mutation }));
vi.mock("@/hooks/useAuditLogs", () => ({ useListAuditLogs: () => harness.query("audit") }));
vi.mock("@/hooks/useTrainingClasses", () => ({ useSetEmployeeCheckinPin: harness.mutation }));
vi.mock("@/hooks/useProfiles", () => ({ useInviteUser: harness.mutation }));
vi.mock("@/hooks/useEmployeeAccess", () => ({ useEmployeeAccessActive: () => harness.query("portal access", true, true) }));
vi.mock("@/components/employees/DiabetesTrainingHistoryCard", () => ({ DiabetesTrainingHistoryCard: () => <div>Diabetes training history</div> }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: (_filters: unknown, options?: { enabled?: boolean }) => harness.query("residents", options?.enabled) }));
vi.mock("@/hooks/useIncidents", () => ({ useListIncidents: (_filters: unknown, options?: { enabled?: boolean }) => harness.query("incidents", options?.enabled) }));
vi.mock("@/hooks/useInspectionItems", () => ({ useListInspectionItems: (_filters: unknown, options?: { enabled?: boolean }) => harness.query("inspections", options?.enabled) }));
vi.mock("@/hooks/useFacilityUnits", () => ({ useListFacilityUnits: (_filters: unknown, options?: { enabled?: boolean }) => harness.query("units", options?.enabled) }));
vi.mock("@/hooks/useEmployeeSchedulePreferences", () => ({ useListEmployeeSchedulePreferences: (_filters: unknown, options?: { enabled?: boolean }) => harness.query("schedules", options?.enabled) }));
vi.mock("@/hooks/useAdministratorProfiles", () => ({ useListAdministratorProfiles: (id?: string) => harness.query("administrator qualifications", !!id), useListAdministratorCeEntriesByOrganization: (id?: string) => harness.query("administrator ce", !!id) }));
vi.mock("@/components/facilities/FacilityClinicalCard", () => ({ FacilityClinicalCard: () => <div>Clinical controls</div> }));
vi.mock("@/components/facilities/FacilityLicensingWorkspace", () => ({ FacilityLicensingWorkspace: () => <div>Licensing controls</div> }));

import EmployeeDetail from "./EmployeeDetail";
import FacilityDetail from "./FacilityDetail";
import { TooltipProvider } from "@/components/ui/tooltip";

beforeEach(() => { harness.fullSuite = false; harness.reads.clear(); });

describe("training-only directory details", () => {
  it("keeps learner editing and training while omitting workforce controls and fetches", () => {
    const html = renderToStaticMarkup(<TooltipProvider><EmployeeDetail /></TooltipProvider>);
    expect(html).toContain("Taylor Learner");
    expect(html).toContain("Invite to Portal");
    expect(html).toContain("Facility training, reports &amp; certificates");
    expect(html).toContain("Diabetes training history");
    for (const label of ["Credentials &amp; Clearances", "Annual Practicums", "Start lifecycle case", "Retention Check-Ins", "Not survey-ready"]) expect(html).not.toContain(label);
    for (const read of ["practicums", "credentials", "duty requirements", "schedule facility assignments", "workforce onboarding", "retention"]) expect(harness.reads.get(read), read).toBe(false);
    expect(harness.reads.get("training records")).toBe(true);
  });

  it("keeps facility information and training without resident, licensing or safety controls", () => {
    const html = renderToStaticMarkup(<FacilityDetail />);
    expect(html).toContain("Training Facility");
    expect(html).toContain("Training Compliance");
    expect(html).toContain("Facility training, reports &amp; certificates");
    for (const label of ["Open Incidents", "Inspection Compliance", "Clinical controls", "Licensing controls", "Safety report poster", "Dementia / Special-Care Readiness", "Additional Requirements"]) expect(html).not.toContain(label);
    for (const read of ["residents", "practicums", "incidents", "inspections", "administrator qualifications", "administrator ce", "units", "schedules"]) expect(harness.reads.get(read), read).toBe(false);
  });

  it("retains the operational controls for the full CareBase suite", () => {
    harness.fullSuite = true;
    const facilityHtml = renderToStaticMarkup(<FacilityDetail />);
    expect(facilityHtml).toContain("Inspection Compliance");
    expect(facilityHtml).toContain("Clinical controls");
    expect(harness.reads.get("residents")).toBe(true);
    expect(harness.reads.get("practicums")).toBe(true);
    const employeeHtml = renderToStaticMarkup(<TooltipProvider><EmployeeDetail /></TooltipProvider>);
    expect(employeeHtml).toContain("Start lifecycle case");
    expect(employeeHtml).toContain("Retention Check-Ins");
    expect(harness.reads.get("credentials")).toBe(true);
  });
});
