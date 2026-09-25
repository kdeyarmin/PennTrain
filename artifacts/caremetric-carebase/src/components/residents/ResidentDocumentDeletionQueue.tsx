import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import {
  useListPendingResidentDocumentDeletions,
  useRetryResidentDocumentDeletion,
  type PendingResidentDocumentDeletion,
} from "@/hooks/useResidentDocuments";

/** Omitting residentId includes authorized pending receipts across residents. */
export function ResidentDocumentDeletionQueue({ residentId, enabled = true }: {
  residentId?: string;
  enabled?: boolean;
}) {
  const pendingDeletions = useListPendingResidentDocumentDeletions(residentId, enabled);
  const retryDeletion = useRetryResidentDocumentDeletion();
  const { toast } = useToast();

  const retry = async (document: PendingResidentDocumentDeletion) => {
    if (!enabled || retryDeletion.isPending) return;
    try {
      await retryDeletion.mutateAsync(document);
      toast({ title: "Document deleted" });
    } catch (error) {
      toast({
        title: "File deletion is still pending",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  if (!enabled) return null;
  if (pendingDeletions.isError) {
    return <QueryError what="pending resident file deletions" error={pendingDeletions.error}
      onRetry={() => void pendingDeletions.refetch()} />;
  }
  if (pendingDeletions.isLoading) return <QueryLoading what="pending resident file deletions" />;
  if (!pendingDeletions.data?.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resident file deletion pending</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          These documents were removed from resident records. Retry to finish deleting their files.
        </p>
        {pendingDeletions.data.map((document) => (
          <div key={document.document_id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{document.file_name}</span>
            <Button variant="outline" size="sm" disabled={retryDeletion.isPending}
              onClick={() => void retry(document)} aria-label={`Retry deletion of ${document.file_name}`}>
              Retry deletion
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
