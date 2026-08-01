import { useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  useDeleteResidentDocument, useListResidentDocuments, useResidentDocumentSignedUrl,
  useUploadResidentDocument, type ResidentDocument,
} from "@/hooks/useResidentDocuments";
import { ResidentPortalWorkspace } from "@/components/residents/ResidentPortalWorkspace";
import { getComplianceFormLabel } from "@/lib/residentCompliance";
import type { ResidentTabProps } from "./types";
import { QueryError } from "@/components/QueryState";

export default function DocumentsTab({ resident, facility, canManage, canDelete }: ResidentTabProps) {
  const { toast } = useToast();
  const documentsQuery = useListResidentDocuments(resident.id);
  const { data: documents, isLoading: documentsLoading } = documentsQuery;
  const uploadDocument = useUploadResidentDocument();
  const getSignedUrl = useResidentDocumentSignedUrl();
  const deleteDocument = useDeleteResidentDocument();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docPendingDelete, setDocPendingDelete] = useState<ResidentDocument | null>(null);
  const formLabel = getComplianceFormLabel(facility?.facility_type);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadDocument.mutateAsync({
        file, organizationId: resident.organization_id, facilityId: resident.facility_id, residentId: resident.id,
      });
      toast({ title: "Document uploaded" });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (doc: ResidentDocument) => {
    try {
      const signedUrl = await getSignedUrl.mutateAsync(doc);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "Download failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const confirmDeleteDocument = async () => {
    if (!docPendingDelete) return;
    try {
      await deleteDocument.mutateAsync(docPendingDelete);
      toast({ title: "Document deleted" });
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setDocPendingDelete(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Documents</CardTitle>
            {canManage && (
              <>
                <Button variant="outline" size="sm" disabled={uploadDocument.isPending} onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-3.5 w-3.5" /> {uploadDocument.isPending ? "Uploading..." : "Upload"}
                </Button>
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUpload} />
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {documentsQuery.isError ? (
            <QueryError what="this resident's documents" error={documentsQuery.error} onRetry={() => void documentsQuery.refetch()} />
          ) : documentsLoading ? (
            <Skeleton className="h-10" />
          ) : !documents?.length ? (
            <p className="text-sm text-muted-foreground">No documents uploaded. Completed DHS {formLabel}/DME forms go here.</p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{doc.file_name}</span>
                      {doc.is_state_form && <Badge variant="outline" className="text-[10px]">State form</Badge>}
                    </div>
                    {doc.state_form_source_label && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        Source: {doc.state_form_source_url ? (
                          <a href={doc.state_form_source_url} target="_blank" rel="noreferrer" className="hover:underline">{doc.state_form_source_label}</a>
                        ) : doc.state_form_source_label}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(doc)} aria-label="Download document">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDocPendingDelete(doc)} aria-label="Delete document">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && <ResidentPortalWorkspace residentId={resident.id} />}

      <AlertDialog open={!!docPendingDelete} onOpenChange={(open) => !open && setDocPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes "{docPendingDelete?.file_name}" and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteDocument} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
