import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { usePendingDocumentDeletions, useRetryDocumentDeletion } from "@/hooks/useDocumentDeletions";
import type { DocumentDeletionKind, PendingDocumentDeletion } from "@/lib/documentDeletion";

/** Facility/organization receipts survive removal of the original record or parent. */
export function DocumentDeletionQueue({ kind, facilityId }: { kind?: DocumentDeletionKind; facilityId?: string }) {
  const pending = usePendingDocumentDeletions(kind, facilityId);
  const retry = useRetryDocumentDeletion();
  const { toast } = useToast();
  const { user } = useAuth();
  const identity = JSON.stringify([user?.id, user?.organizationId, user?.role, user?.facilityId, kind, facilityId]);
  const active = useRef({ identity, generation: 0, mounted: true });
  if (active.current.identity !== identity) {
    active.current = { identity, generation: active.current.generation + 1, mounted: true };
  }
  useEffect(() => { active.current.mounted = true; return () => { active.current.mounted = false; active.current.generation += 1; }; }, []);
  const finish = async (receipt: PendingDocumentDeletion) => {
    if (retry.isPending) return;
    const generation = active.current.generation;
    const isCurrent = () => active.current.mounted && active.current.generation === generation;
    try {
      await retry.mutateAsync(receipt);
      if (isCurrent()) toast({ title: "File deletion completed", description: receipt.file_name });
    } catch (error) {
      if (isCurrent()) toast({ title: "File deletion is still pending", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };
  if (pending.isError) return <QueryError what="pending file deletions" error={pending.error} onRetry={() => void pending.refetch()} />;
  if (pending.isLoading) return <QueryLoading what="pending file deletions" />;
  if (!pending.data?.length) return null;
  return <Card><CardHeader><CardTitle>Pending file deletions</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">These document records were removed. Retry to finish deleting their files. Files still referenced by another document remain protected until that reference is removed.</p>
    {pending.data.map(receipt => <div key={`${receipt.document_kind}:${receipt.document_id}`} className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate">{receipt.file_name}</span>
      <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => void finish(receipt)} aria-label={`Retry deletion of ${receipt.file_name}`}>Retry deletion</Button>
    </div>)}
  </CardContent></Card>;
}
