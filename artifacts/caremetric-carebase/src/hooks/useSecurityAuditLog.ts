import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

// BACKLOG J74 (P3, identity). `identity` was missing, so every row admin-update-user writes for
// an administrator MFA reset (entity_type "identity", action "mfa_reset" -- the I8 control) was
// filtered out of the only page that claims to show sensitive activity.
export type SecurityAuditEntityType = "impersonation" | "identity" | "organizations" | "platform_settings";

const SECURITY_ENTITY_TYPES: SecurityAuditEntityType[] = [
  "impersonation",
  "identity",
  "organizations",
  "platform_settings",
];

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

// id -> "First Last" lookup so the page can show actor names instead of raw profile uuids
// (mirrors useOrganizationNameMap in useAdminNotificationDeliveries.ts).
//
// Takes the ids the caller actually needs. It used to select every profile and index the result,
// on the reasoning -- written in the comment this replaces -- that platform_admin has unrestricted
// profiles SELECT via RLS so no filtering was needed. RLS was never the binding constraint:
// PostgREST caps an unbounded select at `db-max-rows`, 1000 on the hosted default and on the local
// stack, so the map lost everything past the thousandth profile. Unrestricted is precisely what
// makes that reachable -- this is the one caller reading across every tenant at once, so the cap is
// an installation-wide profile count rather than a per-organization one.
//
// The callers all render a miss as "Unknown" / "Unknown requester", so the effect was a real
// person's action attributed to nobody on the SECURITY audit log, which is the page where that
// reads as an unattributed action rather than a cosmetic gap. Same defect and same fix as the
// tenant-facing AuditLog page.
//
// Ids are de-duplicated and sorted into the query key so callers holding the same actors in a
// different order share one cache entry instead of refetching.
export function useProfileNameMap(profileIds: string[]) {
  const ids = Array.from(new Set(profileIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["profiles", "name_map", ids],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const profile of data ?? []) map[profile.id] = `${profile.first_name} ${profile.last_name}`.trim();
      return map;
    },
    // Page changes swap the id set and therefore the query key. Without this, every paged
    // navigation blanks the map for a moment and the rows render "Unknown user" -- the exact string
    // this fix exists to stop showing. Keeping the previous map is safe precisely because it is
    // keyed by profile id: an id it does not carry falls through to the same fallback it would have
    // anyway, and one it does carry is still that person's name.
    placeholderData: (previous) => previous,
    enabled: ids.length > 0,
  });
}
