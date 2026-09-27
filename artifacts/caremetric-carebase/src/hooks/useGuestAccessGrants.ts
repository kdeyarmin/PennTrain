import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type GrantKind = "evidence" | "move_in" | "agreement" | "portal";
export type GrantStatus = "active" | "inactive" | "all";
export interface UnifiedGrant {
  kind: GrantKind;
  id: string;
  label: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  parentHref: string;
  parentLabel: string;
}

export const GRANT_PAGE_SIZE = 50;
const SOURCES = {
  evidence: { table: "evidence_guest_grants", columns: "guest_label,collection_id" },
  move_in: { table: "move_in_guest_grants", columns: "guest_label,workspace_id" },
  agreement: { table: "resident_agreement_guest_grants", columns: "guest_label,resident_id" },
  portal: { table: "resident_portal_grants", columns: "designated_person_name,relationship_label,resident_id" },
} as const;
const KINDS = Object.keys(SOURCES) as GrantKind[];
interface Cursor { createdAt: string; id: string }
export interface GrantPageCursor {
  startedAt?: string;
  after?: Partial<Record<GrantKind, Cursor>>;
  exhausted?: GrantKind[];
}
export interface GrantFilters {
  organizationId: string;
  kind: GrantKind | "all";
  status: GrantStatus;
  residentBase: string;
}
interface GrantRow {
  id: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  guest_label?: string | null;
  designated_person_name?: string | null;
  relationship_label?: string | null;
  collection_id?: string;
  workspace_id?: string;
  resident_id?: string;
}

function toGrant(kind: GrantKind, row: GrantRow, residentBase: string): UnifiedGrant {
  const labels = { evidence: "Evidence guest", move_in: "Move-in guest", agreement: "Agreement signer", portal: "Portal guest" };
  return {
    kind, id: row.id, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at,
    label: kind === "portal"
      ? row.designated_person_name
        ? `${row.designated_person_name}${row.relationship_label ? ` (${row.relationship_label})` : ""}`
        : labels.portal
      : row.guest_label || labels[kind],
    parentHref: kind === "evidence" ? `/app/evidence/${row.collection_id}`
      : kind === "move_in" ? `/app/admissions/move-ins/${row.workspace_id}` : `${residentBase}/${row.resident_id}`,
    parentLabel: kind === "evidence" ? "Open evidence collection" : kind === "move_in" ? "Open move-in workspace" : "Open resident",
  };
}

/** Merge one globally ordered page without an RPC or changing any table's existing RLS. */
export async function fetchGuestGrantPage(filters: GrantFilters, cursor: GrantPageCursor = {}, signal?: AbortSignal) {
  const startedAt = cursor.startedAt ?? new Date().toISOString();
  const now = new Date().toISOString();
  const kinds = (filters.kind === "all" ? KINDS : [filters.kind]).filter(kind => !cursor.exhausted?.includes(kind));
  const sources = await Promise.all(kinds.map(async kind => {
    const source = SOURCES[kind];
    // Do not select token hashes or expand the existing organization/facility access policies.
    let query = supabase.from(source.table)
      .select(`id,expires_at,revoked_at,created_at,${source.columns}`)
      .eq("organization_id", filters.organizationId)
      .lte("created_at", startedAt);
    if (filters.status === "active") query = query.is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${now}`);
    if (filters.status === "inactive") query = query.or(`revoked_at.not.is.null,expires_at.lte.${now}`);
    const after = cursor.after?.[kind];
    // Both values come from the typed database response, never user-entered filter text.
    // Independent .or calls are ANDed by PostgREST, preserving the status predicate above.
    if (after) query = query.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`);
    const ordered = query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(GRANT_PAGE_SIZE + 1);
    const { data, error } = await (signal ? ordered.abortSignal(signal) : ordered);
    if (error) throw error;
    return { kind, rows: ((data ?? []) as unknown as GrantRow[]).map(row => toGrant(kind, row, filters.residentBase)) };
  }));
  const candidates = sources.flatMap(source => source.rows).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id) || a.kind.localeCompare(b.kind));
  const rows = candidates.slice(0, GRANT_PAGE_SIZE);
  const after = { ...cursor.after };
  const exhausted = [...(cursor.exhausted ?? [])];
  for (const source of sources) {
    const emitted = rows.filter(row => row.kind === source.kind);
    const last = emitted.at(-1);
    if (last) after[source.kind] = { createdAt: last.createdAt, id: last.id };
    if (source.rows.length <= GRANT_PAGE_SIZE && emitted.length === source.rows.length) exhausted.push(source.kind);
  }
  const hasMore = candidates.length > rows.length;
  return { rows, nextCursor: hasMore ? { startedAt, after, exhausted } : undefined };
}

export function useGuestAccessGrants(filters: GrantFilters, viewerId?: string) {
  return useInfiniteQuery({
    queryKey: ["guest-access-center", viewerId, filters],
    enabled: !!filters.organizationId && !!viewerId,
    initialPageParam: {} as GrantPageCursor,
    queryFn: ({ pageParam, signal }) => fetchGuestGrantPage(filters, pageParam, signal),
    getNextPageParam: lastPage => lastPage.nextCursor,
  });
}
