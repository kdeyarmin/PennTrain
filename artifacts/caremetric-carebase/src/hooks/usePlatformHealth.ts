import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PlatformHealth {
  orgsByStatus: Record<string, number>;
  notificationDeliveriesPending: number;
  notificationDeliveriesFailed: number;
  aiGenerationsPending: number;
  aiGenerationsFailed: number;
  heygenJobsInProgress: number;
  systemJobsStale: number;
  systemJobsFailed: number;
  auditCoverageMissing: number;
  totalFacilities: number;
  totalEmployees: number;
  totalCourses: number;
  // Expanded aggregates for AdminDashboard KPI tiles (additive; older RPCs omit these).
  activeEmployees?: number;
  employeesMissingEmail?: number;
  employeesMissingFacility?: number;
  expiredCredentials?: number;
  expiringCredentialsWithin30Days?: number;
  openIncidents?: number;
  openViolations?: number;
  openCorrectiveActions?: number;
  overdueCorrectiveActions?: number;
  publishedCourses?: number;
  draftCourses?: number;
  incompleteCourseAssignments?: number;
  overdueCourseAssignments?: number;
  overdueTrainingRecords?: number;
  pendingPolicyAttestations?: number;
  overduePolicyAttestations?: number;
  openAlerts?: number;
}

export interface PlatformDashboardAtRiskOrganization {
  id: string;
  name: string;
  plan_name: string | null;
  subscription_status: string | null;
}

export interface PlatformDashboardOrganizationRow {
  id: string;
  name: string;
  plan_name: string | null;
  subscription_status: string | null;
}

export interface PlatformDashboardTenantHealthRow {
  id: string;
  name: string;
  score: number;
  facilityCount: number;
  employeeCount: number;
  adminCount: number;
}

export interface PlatformDashboardInspectionReadinessRow {
  id: string;
  name: string;
  score: number;
  outstandingItems: number;
  facilityIncidents: number;
  facilityViolations: number;
  facilityOverdueActions: number;
}

export type PlatformDashboardTimelineIcon = "incident" | "violation" | "alert" | "corrective_action";

export interface PlatformDashboardTimelineRow {
  id: string;
  label: string;
  date: string | null;
  href: string;
  status: string | null;
  icon: PlatformDashboardTimelineIcon;
}

export interface PlatformDashboardCourseHotspotRow {
  courseId: string;
  title: string;
  count: number;
}

export interface PlatformDashboardPage {
  openSupportTickets: number;
  missingOrgContacts: number;
  facilitiesMissingLicense: number;
  facilitiesMissingAddress: number;
  organizationsWithoutAdmin: number;
  trainingPlansCount: number;
  atRiskOrganizations: PlatformDashboardAtRiskOrganization[];
  organizationsPage: PlatformDashboardOrganizationRow[];
  tenantHealthScores: PlatformDashboardTenantHealthRow[];
  inspectionReadinessScores: PlatformDashboardInspectionReadinessRow[];
  complianceTimelineItems: PlatformDashboardTimelineRow[];
  coursesNeedingAttention: PlatformDashboardCourseHotspotRow[];
}

export function useGetPlatformHealth() {
  return useQuery({
    queryKey: ["platform-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_platform_health");
      if (error) throw error;
      return data as unknown as PlatformHealth;
    },
    refetchInterval: 60000,
  });
}

export function useGetPlatformAdminDashboardPage(
  params: { limit?: number; offset?: number; organizationsLimit?: number; organizationsOffset?: number } = {},
) {
  const {
    limit = 6,
    offset = 0,
    organizationsLimit = 20,
    organizationsOffset = 0,
  } = params;
  return useQuery({
    queryKey: ["platform-admin-dashboard-page", limit, offset, organizationsLimit, organizationsOffset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_platform_admin_dashboard_page", {
        p_limit: limit,
        p_offset: offset,
        p_organizations_limit: organizationsLimit,
        p_organizations_offset: organizationsOffset,
      });
      if (error) throw error;
      return (data ?? {}) as unknown as PlatformDashboardPage;
    },
    refetchInterval: 60000,
  });
}
