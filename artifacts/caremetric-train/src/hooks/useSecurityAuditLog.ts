import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type SecurityAuditEntityType = "impersonation" | "organizations" | "platform_settings";

const SECURITY_ENTITY_TYPES: SecurityAuditEntityType[] = ["impersonation", "organizations", "platform_settings"];

export interface ListSecurityAuditLogFilters {
  entityType?: SecurityAuditEntityType;
  limit?: number;
}

export interface AuditCoverageEntry {
  table_name: string;
  audit_mode: "row_trigger" | "domain_evidence" | "access_log" | "not_required";
  contains_regulated_data: boolean;
  has_required_trigger: boolean;
  rationale: string;
}

export interface AuditGovernanceStatus {
  hashVersion: number;
  openIntegrityIssues: number;
  activeLegalHolds: number;
  plannedArchives: number;
  oldestHotEvidenceAt: string | null;
  retentionClasses: Array<{
    retentionDays: number;
    archiveAfterDays: number;
    tableCount: number;
  }>;
}

export function useAuditCoverage() {
  return useQuery({
    queryKey: ["audit-coverage"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_audit_coverage");
      if (error) throw error;
      return (data ?? []) as unknown as AuditCoverageEntry[];
    },
    refetchInterval: 60000,
  });
}

export function useAuditGovernanceStatus() {
  return useQuery({
    queryKey: ["audit-governance-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_audit_governance_status");
      if (error) throw error;
      return data as unknown as AuditGovernanceStatus;
    },
    refetchInterval: 60000,
  });
}

// Dedicated query for the platform_admin-only Security & Governance page.
// Deliberately kept separate from useAuditLogs.ts's useListAuditLogs -- that
// hook is shared by the generic /admin/audit page (and possibly other
// callers), and doesn't support the entity_type.in(...) narrowing this page
// needs to isolate impersonation/organizations/platform_settings rows from
// the rest of the audit trail.
export function useListSecurityAuditLog(filters: ListSecurityAuditLogFilters = {}) {
  return useQuery({
    queryKey: ["security_audit_log", filters],
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .in("entity_type", SECURITY_ENTITY_TYPES)
        .order("created_at", { ascending: false })
        .limit(filters.limit ?? 300);
      if (filters.entityType) query = query.eq("entity_type", filters.entityType);
      const { data, error } = await query;
      if (error) throw error;
      return data as Tables<"audit_logs">[];
    },
  });
}

// id -> "First Last" lookup so the page can show actor names instead of raw
// profile uuids (mirrors useOrganizationNameMap in useAdminNotificationDeliveries.ts).
// platform_admin has unrestricted profiles SELECT via RLS, so no filtering needed --
// this intentionally fetches every profile rather than scoping by organization.
export function useProfileNameMap() {
  return useQuery({
    queryKey: ["profiles", "name_map"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, first_name, last_name");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const profile of data ?? []) map[profile.id] = `${profile.first_name} ${profile.last_name}`.trim();
      return map;
    },
  });
}
