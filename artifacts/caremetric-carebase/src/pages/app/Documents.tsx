import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import {
  useListDocuments, useUploadDocument, useDocumentSignedUrl, useDeleteDocument,
  type TrainingDocument, type UploadDocumentInput,
} from "@/hooks/useDocuments";
import { useAuth, type Role } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { FileText, Upload, Trash2, Download, Files, UserRound } from "lucide-react";

// Matches the training_documents_delete RLS policy (org_admin/facility_manager, or
// platform_admin via is_platform_admin()) — trainer and employee can never delete a
// training document (not even their own upload), so the control must not render for them.
const DOCUMENTS_DELETE_ROLES: Role[] = ["org_admin", "facility_manager", "platform_admin"];

const DOC_TYPE_LABELS: Record<string, string> = {
  certificate: "Certificate",
  roster: "Roster",
  practicum_form: "Practicum Form",
  transcript: "Transcript",
  external_certificate: "External Certificate",
  competency_attachment: "Competency Attachment",
  other: "Other",
};

// Maps each document type to the private Storage bucket it belongs in.
const DOC_TYPE_BUCKETS: Record<string, UploadDocumentInput["bucket"]> = {
  certificate: "external-uploads",
  external_certificate: "external-uploads",
  transcript: "external-uploads",
  other: "external-uploads",
  roster: "signin-sheets",
  practicum_form: "signin-sheets",
  competency_attachment: "competency-attachments",
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Documents() {
  const { user } = useAuth();
  const [facilityId, setFacilityId] = useState<string>("all");
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [docType, setDocType] = useState<string>("all");
  const [uploadFacility, setUploadFacility] = useState<string>("");
  const [uploadEmployee, setUploadEmployee] = useState<string>("none");
  const [uploadDocType, setUploadDocType] = useState<string>("certificate");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees({
    facilityId: uploadFacility || undefined,
  });
  // Scoped to the read-side Facility filter below (not uploadFacility above, which scopes the
  // upload form's own employee picker) -- narrows as that filter narrows, same as the document
  // list itself.
  const { data: filterEmployees } = useListEmployees({
    facilityId: facilityId !== "all" ? facilityId : undefined,
  });

  const { data: documents, isLoading } = useListDocuments({
    facilityId: facilityId !== "all" ? facilityId : undefined,
    employeeId: employeeId !== "all" ? employeeId : undefined,
    documentType: docType !== "all" ? docType : undefined,
  });

  const uploadDocument = useUploadDocument();
  const getSignedUrl = useDocumentSignedUrl();
  const deleteDocument = useDeleteDocument();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!uploadFacility) {
      toast({ title: "Select a facility first", variant: "destructive" });
      return;
    }
    if (!user?.organizationId) {
      toast({ title: "No organization on your account", variant: "destructive" });
      return;
    }

    try {
      await uploadDocument.mutateAsync({
        file,
        bucket: DOC_TYPE_BUCKETS[uploadDocType] ?? "external-uploads",
        organizationId: user.organizationId,
        facilityId: uploadFacility,
        employeeId: uploadEmployee !== "none" ? uploadEmployee : undefined,
        documentType: uploadDocType,
      });
      toast({ title: "Document uploaded successfully" });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const [deleteDoc, setDeleteDoc] = useState<TrainingDocument | null>(null);

  const confirmDelete = async () => {
    if (!deleteDoc) return;
    try {
      await deleteDocument.mutateAsync(deleteDoc);
      toast({ title: "Document deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeleteDoc(null);
    }
  };

  const handleDownload = async (doc: TrainingDocument) => {
    try {
      const signedUrl = await getSignedUrl.mutateAsync(doc);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "Download failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const uploading = uploadDocument.isPending;
  const canDelete = !!user && DOCUMENTS_DELETE_ROLES.includes(user.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
        <p className="text-muted-foreground">Upload and manage training certificates and compliance documents</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Document
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Facility</label>
              <Select value={uploadFacility} onValueChange={setUploadFacility}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Select facility" />
                </SelectTrigger>
                <SelectContent>
                  {facilities?.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Employee (optional)</label>
              <Select value={uploadEmployee} onValueChange={setUploadEmployee}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific employee</SelectItem>
                  {employees?.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Document Type</label>
              <Select value={uploadDocType} onValueChange={setUploadDocType}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="certificate">Certificate</SelectItem>
                  <SelectItem value="roster">Roster</SelectItem>
                  <SelectItem value="practicum_form">Practicum Form</SelectItem>
                  <SelectItem value="transcript">Transcript</SelectItem>
                  <SelectItem value="external_certificate">External Certificate</SelectItem>
                  <SelectItem value="competency_attachment">Competency Attachment</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={uploading || !uploadFacility}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Choose File"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleUpload}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Accepted formats: PDF, JPG, PNG, DOC, DOCX. Max 20MB.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2">
              <Files className="h-5 w-5" />
              Document Repository
            </CardTitle>
            <div className="flex gap-2 flex-wrap">
              <Select value={facilityId} onValueChange={v => { setFacilityId(v); setEmployeeId("all"); }}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All Facilities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Facilities</SelectItem>
                  {facilities?.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All Employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {filterEmployees?.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="certificate">Certificate</SelectItem>
                  <SelectItem value="roster">Roster</SelectItem>
                  <SelectItem value="practicum_form">Practicum Form</SelectItem>
                  <SelectItem value="transcript">Transcript</SelectItem>
                  <SelectItem value="external_certificate">External Certificate</SelectItem>
                  <SelectItem value="competency_attachment">Competency Attachment</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : !documents?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-40" />
              <p className="font-medium">No documents yet</p>
              <p className="text-sm mt-1">Upload training certificates and compliance documents above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/5 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-9 w-9 shrink-0 text-primary/70" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{doc.file_name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <Badge variant="outline" className="text-xs">{DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}</Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <UserRound className="h-3 w-3" />
                          {doc.employees ? `${doc.employees.first_name} ${doc.employees.last_name}` : "Unassigned"}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatFileSize(doc.file_size)}</span>
                        <span className="text-xs text-muted-foreground">{new Date(doc.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => handleDownload(doc)} title="Download">
                      <Download className="h-4 w-4" />
                    </Button>
                    {canDelete && (
                      <Button size="icon" variant="ghost" onClick={() => setDeleteDoc(doc)} title="Delete">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteDoc} onOpenChange={(open) => !open && setDeleteDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteDoc?.file_name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
