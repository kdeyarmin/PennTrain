import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { IncidentAnalyticsSummary } from "@/lib/incidentAnalytics";
import type { ResidentComplianceAnalyticsSummary } from "@/lib/residentComplianceAnalytics";

export const EMPTY_INCIDENT_LIST_SUMMARY: IncidentAnalyticsSummary = {
  total: 0,
  open: 0,
  criticalOpen: 0,
  majorOrCritical: 0,
  reportedLast7Days: 0,
  reportedLast30Days: 0,
  oldestOpenIncidentId: null,
  topIncidentType: null,
};

export const EMPTY_RESIDENT_LIST_SUMMARY: ResidentComplianceAnalyticsSummary = {
  residents: 0,
  activeResidents: 0,
  residentsWithOpenItems: 0,
  expiredItems: 0,
  missingItems: 0,
  dueSoonItems: 0,
  dueWithin14Days: 0,
  newestAdmissionResidentId: null,
};

export interface ComplaintListSummary {
  total: number;
  openCases: number;
  awaitingAcknowledgement: number;
  highOrImminentRisk: number;
  incidentLinked: number;
}

export const EMPTY_COMPLAINT_LIST_SUMMARY: ComplaintListSummary = {
  total: 0,
  openCases: 0,
  awaitingAcknowledgement: 0,
  highOrImminentRisk: 0,
  incidentLinked: 0,
};

interface ComplaintListSummaryFilters {
  facilityId?: string;
  status?: string;
  category?: string;
  search?: string;
  excludeStatus?: string;
}

export function useComplaintListSummary(filters: ComplaintListSummaryFilters) {
  return useQuery({
    queryKey: ["complaints", "summary", filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_complaint_list_summary", {
        p_facility_id: filters.facilityId,
        p_status: filters.status,
        p_category: filters.category,
        p_search: filters.search,
        p_exclude_status: filters.excludeStatus,
      });
      if (error) throw error;
      return (data ?? EMPTY_COMPLAINT_LIST_SUMMARY) as unknown as ComplaintListSummary;
    },
    placeholderData: (previous) => previous,
  });
}

export interface EvidenceCollectionListSummary {
  total: number;
  draft: number;
  published: number;
  legalHolds: number;
}

export const EMPTY_EVIDENCE_COLLECTION_LIST_SUMMARY: EvidenceCollectionListSummary = {
  total: 0,
  draft: 0,
  published: 0,
  legalHolds: 0,
};

export function useEvidenceCollectionListSummary(filters: { facilityId?: string }) {
  return useQuery({
    queryKey: ["evidence", "collections", "summary", filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_evidence_collection_list_summary", {
        p_facility_id: filters.facilityId,
      });
      if (error) throw error;
      return (data ?? EMPTY_EVIDENCE_COLLECTION_LIST_SUMMARY) as unknown as EvidenceCollectionListSummary;
    },
    placeholderData: (previous) => previous,
  });
}

interface IncidentListSummaryFilters {
  facilityId?: string;
  residentId?: string;
  severity?: string;
  status?: string;
  search?: string;
  today: string;
}

interface ResidentListSummaryFilters {
  facilityId?: string;
  status?: string;
  search?: string;
  today: string;
}

export function useIncidentListSummary(filters: IncidentListSummaryFilters) {
  return useQuery({
    queryKey: ["incidents", "summary", filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_incident_list_summary", {
        p_facility_id: filters.facilityId,
        p_resident_id: filters.residentId,
        p_severity: filters.severity,
        p_status: filters.status,
        p_search: filters.search,
        p_today: filters.today,
      });
      if (error) throw error;
      return (data ?? EMPTY_INCIDENT_LIST_SUMMARY) as unknown as IncidentAnalyticsSummary;
    },
    placeholderData: (previous) => previous,
  });
}

export function useResidentListSummary(filters: ResidentListSummaryFilters) {
  return useQuery({
    queryKey: ["residents", "summary", filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_resident_list_summary", {
        p_facility_id: filters.facilityId,
        p_status: filters.status,
        p_search: filters.search,
        p_today: filters.today,
      });
      if (error) throw error;
      return (data ?? EMPTY_RESIDENT_LIST_SUMMARY) as unknown as ResidentComplianceAnalyticsSummary;
    },
    placeholderData: (previous) => previous,
  });
}
