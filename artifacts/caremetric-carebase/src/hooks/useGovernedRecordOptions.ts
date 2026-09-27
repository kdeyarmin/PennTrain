import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const GOVERNED_RECORD_SOURCES = {
  organization: { table: "organizations", columns: "id,name", order: "name", global: true },
  portfolio: { table: "enterprise_portfolios", columns: "id,name,code,status", order: "name", global: true },
  region: { table: "enterprise_regions", columns: "id,name,code,status", order: "name", global: true },
  facility: { table: "facilities", columns: "id,name,is_active", order: "name", global: false },
  employee: { table: "employees", columns: "id,first_name,last_name,job_title,status", order: "last_name", global: false },
  profile: { table: "profiles", columns: "id,first_name,last_name,email,role,is_active", order: "last_name", global: false },
  compliance_profile: { table: "compliance_profile_definitions", columns: "id,name,code,version,is_active", order: "name", global: false },
  rule_version: { table: "regulatory_rule_versions", columns: "id,citation,authority_name,version_number,state", order: "citation", global: true },
  domain: { table: "organization_identity_domains", columns: "id,domain,verification_status,revoked_at", order: "domain", global: false },
  incident: { table: "incidents", columns: "id,incident_type,occurred_at,location_detail,status", order: "occurred_at", global: false },
  complaint: { table: "complaints", columns: "id,complaint_number,category,date_received,status", order: "date_received", global: false },
  work_item: { table: "work_items", columns: "id,title,state,due_at", order: "title", global: false },
} as const;

export type GovernedRecordKind = keyof typeof GOVERNED_RECORD_SOURCES;
export interface GovernedRecordOption { id: string; label: string; description: string }
type RecordRow = Record<string, unknown> & { id: string };
interface LookupQuery extends PromiseLike<{ data: RecordRow[] | null; error: { message: string } | null }> {
  select(columns: string): LookupQuery;
  order(column: string): LookupQuery;
  range(from: number, to: number): LookupQuery;
  abortSignal(signal: AbortSignal): LookupQuery;
  eq(column: string, value: string | boolean): LookupQuery;
  is(column: string, value: null): LookupQuery;
  or(filters: string): LookupQuery;
}
// The allowlist above pairs the columns with each generated table. Keep the dynamic
// summary reader narrow: no arbitrary table names, mutations, or privileged client.
const lookupClient = supabase as unknown as { from(table: typeof GOVERNED_RECORD_SOURCES[GovernedRecordKind]["table"]): LookupQuery };
const readable = (value: unknown) => String(value ?? "").replace(/_/g, " ");

export function governedRecordOption(kind: GovernedRecordKind, row: RecordRow): GovernedRecordOption {
  let label = String(row.name ?? row.domain ?? row.title ?? "");
  let detail = readable(row.status ?? row.state ?? row.verification_status ?? row.code);
  if (kind === "employee" || kind === "profile") {
    label = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || String(row.email ?? "Unnamed person");
    detail = [row.email ?? row.job_title, readable(row.role ?? row.status)].filter(Boolean).join(" · ");
  } else if (kind === "rule_version") {
    label = `${row.citation || row.authority_name || "Rule"} · Version ${row.version_number}`;
  } else if (kind === "compliance_profile") {
    detail = `${row.code} · Version ${row.version}`;
  } else if (kind === "incident") {
    label = `${readable(row.incident_type)} · ${row.occurred_at ? new Date(String(row.occurred_at)).toLocaleString() : "Date unavailable"}`;
    detail = [row.location_detail, detail].filter(Boolean).join(" · ");
  } else if (kind === "complaint") {
    label = `${row.complaint_number} · ${readable(row.category)}`;
    detail = [row.date_received, detail].filter(Boolean).join(" · ");
  }
  if (row.is_active === false) detail = [detail, "Inactive"].filter(Boolean).join(" · ");
  detail = [detail, `Ref ${row.id.slice(0, 8)}`].filter(Boolean).join(" · ");
  return { id: row.id, label: label || "Unnamed record", description: detail };
}

/** The submitting form also validates its choice: a retained label after a failed read
 * must not be treated as a current, available record. Optional blanks remain optional. */
export function useAvailableGovernedRecord(kind: GovernedRecordKind, value: string, organizationId?: string, optional = false, verifiedDomainsOnly = false) {
  const query = useGovernedRecordOptions(kind, organizationId, undefined, verifiedDomainsOnly);
  return optional && !value || !query.isError && !query.isLoading && !!query.data?.some(option => option.id === value);
}

// These reads use the signed-in client and existing RLS. A tenant-scoped lookup is never
// allowed to run before its organization is known, including for platform operators.
export function useGovernedRecordOptions(kind: GovernedRecordKind, organizationId?: string, facilityId?: string, verifiedDomainsOnly = false) {
  const source = GOVERNED_RECORD_SOURCES[kind];
  return useQuery({
    queryKey: ["governed-record-options", kind, organizationId, facilityId, verifiedDomainsOnly],
    enabled: source.global || !!organizationId,
    queryFn: async ({ signal }): Promise<GovernedRecordOption[]> => {
      if (!source.global && !organizationId) return [];
      const rows: RecordRow[] = [];
      for (let from = 0; ;) {
        let query = lookupClient.from(source.table).select(source.columns).order(source.order).order("id")
          .range(from, from + 499).abortSignal(signal);
        if (!source.global) {
          query = kind === "compliance_profile"
            ? query.or(`organization_id.eq.${organizationId},organization_id.is.null`)
            : query.eq("organization_id", organizationId!);
        }
        if (facilityId && ["employee", "incident", "complaint", "work_item"].includes(kind)) query = query.eq("facility_id", facilityId);
        if (kind === "domain") {
          query = query.is("revoked_at", null);
          if (verifiedDomainsOnly) query = query.eq("verification_status", "verified");
        }
        if (kind === "compliance_profile") query = query.eq("is_active", true);
        const { data, error } = await query;
        if (error) throw error;
        const page = data;
        if (!page?.length) break;
        rows.push(...page);
        from += page.length;
      }
      return rows.map(row => governedRecordOption(kind, row));
    },
  });
}
