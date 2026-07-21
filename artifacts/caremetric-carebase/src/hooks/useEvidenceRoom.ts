import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import { rangeFor } from "@/lib/utils";
import type { PaginatedResult } from "@/lib/dataTable";

// The evidence room shares immutable, checksummed report artifacts with outside
// surveyors: staff assemble a facility-scoped collection from completed binder exports,
// publish it, and mint revocable expiring guest links. Reads ride RLS; every write goes
// through a lifecycle RPC, and the guest surface is token-scoped and anon-callable.

export type EvidenceCollection = Tables<"evidence_collections"> & {
  facility: { name: string } | null;
};

export type EvidenceArtifact = Tables<"evidence_collection_artifacts"> & {
  snapshot_artifact: Pick<
    Tables<"report_snapshot_artifacts">,
    "artifact_type" | "byte_size" | "content_sha256"
  > | null;
};

export type EvidenceGuestGrant = Tables<"evidence_guest_grants">;
export type EvidenceAccessEvent = Tables<"evidence_guest_access_events">;

export function useListEvidenceCollections(filters: { organizationId?: string } = {}) {
  return useQuery({
    queryKey: ["evidence", "collections", filters],
    queryFn: async () => {
      let query = supabase
        .from("evidence_collections")
        .select("*, facility:facilities(name)")
        .order("created_at", { ascending: false });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as EvidenceCollection[];
    },
  });
}

export interface PaginatedEvidenceCollectionsFilters {
  organizationId?: string;
  facilityId?: string;
  status?: string;
  page: number;
  pageSize: number;
}

// Server-side paginated evidence collections that keep the facility-name join the list renders.
export function usePaginatedEvidenceCollections(filters: PaginatedEvidenceCollectionsFilters) {
  return useQuery({
    queryKey: ["evidence", "collections", "paginated", filters],
    queryFn: async ({ signal }): Promise<PaginatedResult<EvidenceCollection>> => {
      let query = supabase.from("evidence_collections").select("*, facility:facilities(name)", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .abortSignal(signal);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      const [from, to] = rangeFor(filters.page, filters.pageSize);
      const { data, error, count } = await query.range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as EvidenceCollection[], count: count ?? 0 };
    },
    placeholderData: (previous) => previous,
  });
}

export function useEvidenceCollection(collectionId: string | undefined) {
  return useQuery({
    queryKey: ["evidence", "detail", collectionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("evidence_collections")
        .select("*, facility:facilities(name)")
        .eq("id", collectionId!)
        .single();
      if (error) throw error;
      return data as unknown as EvidenceCollection;
    },
    enabled: !!collectionId,
  });
}

export function useEvidenceArtifacts(collectionId: string | undefined) {
  return useQuery({
    queryKey: ["evidence", "artifacts", collectionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("evidence_collection_artifacts")
        .select("*, snapshot_artifact:report_snapshot_artifacts(artifact_type, byte_size, content_sha256)")
        .eq("collection_id", collectionId!)
        .order("added_at");
      if (error) throw error;
      return data as unknown as EvidenceArtifact[];
    },
    enabled: !!collectionId,
  });
}

export function useEvidenceGrants(collectionId: string | undefined) {
  return useQuery({
    queryKey: ["evidence", "grants", collectionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("evidence_guest_grants")
        .select("*")
        .eq("collection_id", collectionId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as EvidenceGuestGrant[];
    },
    enabled: !!collectionId,
  });
}

export function useEvidenceAccessEvents(collectionId: string | undefined) {
  return useQuery({
    queryKey: ["evidence", "events", collectionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("evidence_guest_access_events")
        .select("*")
        .eq("collection_id", collectionId!)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as EvidenceAccessEvent[];
    },
    enabled: !!collectionId,
  });
}

/** Completed, checksummed binder exports are the promotable artifact source. */
export function usePromotableBinderExports(facilityId: string | undefined) {
  return useQuery({
    queryKey: ["evidence", "promotable-exports", facilityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("binder_export_jobs")
        .select("*")
        .eq("status", "succeeded")
        .order("completed_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []).filter(
        (job) =>
          job.content_sha256 !== null &&
          Array.isArray(job.facility_ids) &&
          job.facility_ids.length === 1 &&
          job.facility_ids[0] === facilityId,
      );
    },
    enabled: !!facilityId,
  });
}

function useEvidenceMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["evidence"] }),
  });
}

export function useCreateEvidenceCollection() {
  return useEvidenceMutation(async (args: { facilityId: string; name: string; purpose: string }) => {
    const { data, error } = await supabase.rpc("create_evidence_collection", {
      p_facility_id: args.facilityId,
      p_name: args.name,
      p_purpose: args.purpose,
    });
    if (error) throw error;
    return data as unknown as Tables<"evidence_collections">;
  });
}

export function useAddBinderExportToCollection() {
  return useEvidenceMutation(async (args: { collectionId: string; binderJobId: string; displayName: string }) => {
    const { data, error } = await supabase.rpc("add_binder_export_to_evidence_collection", {
      p_collection_id: args.collectionId,
      p_binder_job_id: args.binderJobId,
      p_display_name: args.displayName,
    });
    if (error) throw error;
    return data as unknown as Tables<"evidence_collection_artifacts">;
  });
}

export function useSetEvidenceCollectionStatus() {
  return useEvidenceMutation(async (args: { collectionId: string; status: "published" | "closed" | "withdrawn" }) => {
    const { data, error } = await supabase.rpc("set_evidence_collection_status", {
      p_collection_id: args.collectionId,
      p_status: args.status,
    });
    if (error) throw error;
    return data as unknown as Tables<"evidence_collections">;
  });
}

export function useSetEvidenceLegalHold() {
  return useEvidenceMutation(async (args: { collectionId: string; hold: boolean }) => {
    const { data, error } = await supabase.rpc("set_evidence_collection_legal_hold", {
      p_collection_id: args.collectionId,
      p_hold: args.hold,
    });
    if (error) throw error;
    return data as unknown as Tables<"evidence_collections">;
  });
}

export function useWithdrawEvidenceArtifact() {
  return useEvidenceMutation(async (args: { artifactId: string; reason: string }) => {
    const { data, error } = await supabase.rpc("withdraw_evidence_collection_artifact", {
      p_artifact_id: args.artifactId,
      p_reason: args.reason,
    });
    if (error) throw error;
    return data as unknown as Tables<"evidence_collection_artifacts">;
  });
}

export interface IssuedGuestGrant {
  grantId: string;
  /** The raw link token -- returned exactly once, only its hash is stored. */
  token: string;
  expiresAt: string;
}

export function useIssueEvidenceGuestGrant() {
  return useEvidenceMutation(async (args: {
    collectionId: string;
    guestLabel: string;
    artifactIds: string[];
    expiresAt: string;
  }) => {
    const { data, error } = await supabase.rpc("issue_evidence_guest_grant", {
      p_collection_id: args.collectionId,
      p_guest_label: args.guestLabel,
      // The SQL parameter is nullable but has no default, so the generated type is `string`.
      p_guest_email_hash: null as unknown as string,
      p_allowed_artifact_ids: args.artifactIds,
      p_expires_at: args.expiresAt,
      p_step_up: false,
    });
    if (error) throw error;
    return data as unknown as IssuedGuestGrant;
  });
}

export function useRevokeEvidenceGuestGrant() {
  return useEvidenceMutation(async (args: { grantId: string; reason: string }) => {
    const { data, error } = await supabase.rpc("revoke_evidence_guest_grant", {
      p_grant_id: args.grantId,
      p_reason: args.reason,
    });
    if (error) throw error;
    return data as unknown as Tables<"evidence_guest_grants">;
  });
}

// ---------------------------------------------------------------------------
// Guest surface (no session -- the grant token is the credential)
// ---------------------------------------------------------------------------

export interface EvidenceGuestArtifact {
  id: string;
  displayName: string;
  addedAt: string;
  artifactType: string;
  byteSize: number | null;
  contentSha256: string | null;
}

export interface EvidenceGuestRoomPayload {
  authorized: boolean;
  reason?: "access_denied" | "step_up_required";
  needsTerms?: boolean;
  guestLabel?: string;
  termsVersion?: string;
  expiresAt?: string;
  acceptedAt?: string;
  collection?: { name: string; purpose: string };
  artifacts?: EvidenceGuestArtifact[];
}

export function useEvidenceGuestRoom(token: string | undefined) {
  return useQuery({
    queryKey: ["evidence_guest_room", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_evidence_guest_room", { p_token: token! });
      if (error) throw error;
      return data as unknown as EvidenceGuestRoomPayload;
    },
    enabled: !!token,
    retry: 1,
  });
}

export function useAcceptEvidenceGuestTerms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.rpc("accept_evidence_guest_terms", { p_token: token });
      if (error) throw error;
      return data as unknown as { accepted: boolean; reason?: string };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["evidence_guest_room"] }),
  });
}

export function useEvidenceGuestDownload() {
  return useMutation({
    mutationFn: async (args: { token: string; artifactId: string }) => {
      const { data, error } = await supabase.functions.invoke<{
        authorized?: boolean;
        url?: string;
        displayName?: string;
        error?: string;
      }>("evidence-guest-download", { body: { token: args.token, artifactId: args.artifactId } });
      if (error) throw error;
      if (!data?.authorized || !data.url) throw new Error(data?.error ?? "This document is no longer available");
      return data as { url: string; displayName?: string };
    },
  });
}
