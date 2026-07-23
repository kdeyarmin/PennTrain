import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RegulatoryUpdate, RegulatoryUpdateStatus } from "@/lib/regulatoryUpdates";

// regulatory_updates and list_regulatory_updates() are present in the generated types, but we still
// reach them through a small structural adapter (the same escape hatch as useGovernedLearning /
// usePaginatedDomainLists) because the generated RPC signature doesn't fit our usage: its args are
// typed non-null (string/number) yet we pass null as the "no filter" sentinel, and its Returns mark
// nullable columns (body, citation, source_uri, effective_date, ...) as non-null. The hand-written
// RegulatoryUpdate type below models the real nullability.
interface RpcResult<T> {
  data: T | null;
  error: { message: string } | null;
}
interface UntypedClient {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult<unknown>>;
  from: (table: string) => any;
}
const client = supabase as unknown as UntypedClient;

export interface RegulatoryUpdateFilters {
  category?: string | null;
  facilityType?: string | null;
  limit?: number;
}

/**
 * Public, unauthenticated read of the *published* regulatory-update feed via the SECURITY DEFINER
 * `list_regulatory_updates` RPC. Draft/archived rows are never returned — the RPC fixes the
 * status filter server-side, so there is no anon table grant to leak them.
 */
export function useRegulatoryUpdates(filters: RegulatoryUpdateFilters = {}) {
  const { category = null, facilityType = null, limit = 50 } = filters;
  return useQuery({
    queryKey: ["regulatory-updates", category, facilityType, limit],
    queryFn: async (): Promise<RegulatoryUpdate[]> => {
      const { data, error } = await client.rpc("list_regulatory_updates", {
        p_category: category,
        p_facility_type: facilityType,
        p_limit: limit,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as RegulatoryUpdate[];
    },
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Admin management (platform_admin only; gated by RLS on regulatory_updates)
// ---------------------------------------------------------------------------

export interface AdminRegulatoryUpdate extends RegulatoryUpdate {
  status: RegulatoryUpdateStatus;
  created_at: string;
  updated_at: string;
}

export interface RegulatoryUpdateInput {
  slug: string;
  title: string;
  summary: string;
  body?: string | null;
  category: string;
  facility_types: string[];
  citation?: string | null;
  state?: string | null;
  source_name?: string | null;
  source_uri?: string | null;
  effective_date?: string | null;
  status: RegulatoryUpdateStatus;
  is_featured: boolean;
  published_at?: string | null;
}

const ADMIN_COLUMNS =
  "id,slug,title,summary,body,category,facility_types,citation,state,source_name,source_uri,effective_date,published_at,is_featured,status,created_at,updated_at";

/** Admin list of every update (all statuses), newest first. RLS restricts this to platform admins. */
export function useAdminRegulatoryUpdates() {
  return useQuery({
    queryKey: ["admin-regulatory-updates"],
    queryFn: async (): Promise<AdminRegulatoryUpdate[]> => {
      const { data, error } = await client
        .from("regulatory_updates")
        .select(ADMIN_COLUMNS)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AdminRegulatoryUpdate[];
    },
    staleTime: 30_000,
  });
}

/**
 * Normalize the publish timestamp so it always tracks status: publishing stamps `published_at`
 * (if not already set), while draft/archived clears it so the row leaves the public feed.
 */
function withPublishTimestamp(input: RegulatoryUpdateInput): RegulatoryUpdateInput {
  if (input.status === "published") {
    return { ...input, published_at: input.published_at ?? new Date().toISOString() };
  }
  return { ...input, published_at: null };
}

export function useCreateRegulatoryUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegulatoryUpdateInput) => {
      const { data, error } = await client
        .from("regulatory_updates")
        .insert(withPublishTimestamp(input))
        .select(ADMIN_COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      return data as AdminRegulatoryUpdate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-regulatory-updates"] });
      queryClient.invalidateQueries({ queryKey: ["regulatory-updates"] });
    },
  });
}

export function useUpdateRegulatoryUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: RegulatoryUpdateInput }) => {
      const { data, error } = await client
        .from("regulatory_updates")
        .update(withPublishTimestamp(input))
        .eq("id", id)
        .select(ADMIN_COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      return data as AdminRegulatoryUpdate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-regulatory-updates"] });
      queryClient.invalidateQueries({ queryKey: ["regulatory-updates"] });
    },
  });
}

export function useDeleteRegulatoryUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("regulatory_updates").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-regulatory-updates"] });
      queryClient.invalidateQueries({ queryKey: ["regulatory-updates"] });
    },
  });
}
