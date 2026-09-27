import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { finishDocumentDeletion, type DocumentDeletionKind, type PendingDocumentDeletion } from "@/lib/documentDeletion";

export function usePendingDocumentDeletions(kind?: DocumentDeletionKind, facilityId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["document_deletions", user?.id, user?.organizationId, user?.role, user?.facilityId, kind ?? "all", facilityId ?? "all"],
    enabled: !!user?.id,
    queryFn: async ({ signal }) => {
      const rows: PendingDocumentDeletion[] = [];
      for (let from = 0; ;) {
        const { data, error } = await supabase.rpc("list_pending_document_deletions", {
          ...(kind ? { p_document_kind: kind } : {}), ...(facilityId ? { p_facility_id: facilityId } : {}),
        }).range(from, from + 499).abortSignal(signal);
        if (error) throw error;
        if (!data?.length) return rows;
        rows.push(...data);
        from += data.length;
      }
    },
  });
}

export function useRetryDocumentDeletion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (receipt: PendingDocumentDeletion) => finishDocumentDeletion(receipt),
    onSettled: () => client.invalidateQueries({ queryKey: ["document_deletions"] }),
  });
}
