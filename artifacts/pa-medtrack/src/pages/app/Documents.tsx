import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListFacilities, useListEmployees } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { FileText, Upload, Trash2, Download, Files } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface TrainingDocument {
  id: number;
  organizationId: number;
  facilityId: number;
  employeeId: number | null;
  trainingRecordId: number | null;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number | null;
  uploadedByUserId: number | null;
  documentType: "certificate" | "roster" | "practicum_form" | "transcript" | "other";
  createdAt: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  certificate: "Certificate",
  roster: "Roster",
  practicum_form: "Practicum Form",
  transcript: "Transcript",
  other: "Other",
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Documents() {
  const [facilityId, setFacilityId] = useState<string>("all");
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [docType, setDocType] = useState<string>("all");
  const [uploading, setUploading] = useState(false);
  const [uploadFacility, setUploadFacility] = useState<string>("");
  const [uploadEmployee, setUploadEmployee] = useState<string>("none");
  const [uploadDocType, setUploadDocType] = useState<string>("certificate");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: facilities } = useListFacilities({});
  const { data: employees } = useListEmployees({
    facilityId: uploadFacility ? Number(uploadFacility) : undefined,
  });

  const queryParams = new URLSearchParams();
  if (facilityId !== "all") queryParams.set("facilityId", facilityId);
  if (employeeId !== "all") queryParams.set("employeeId", employeeId);
  if (docType !== "all") queryParams.set("documentType", docType);

  const { data: documents, isLoading } = useQuery<TrainingDocument[]>({
    queryKey: ["documents", facilityId, employeeId, docType],
    queryFn: async () => {
      const res = await fetch(`/api/documents?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!uploadFacility) {
      toast({ title: "Select a facility first", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("facilityId", uploadFacility);
      formData.append("documentType", uploadDocType);
      if (uploadEmployee && uploadEmployee !== "none") formData.append("employeeId", uploadEmployee);

      const res = await fetch(`/api/documents`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      toast({ title: "Document uploaded successfully" });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: TrainingDocument) => {
    if (!confirm(`Delete "${doc.fileName}"?`)) return;
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "Document deleted" });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handleDownload = (doc: TrainingDocument) => {
    const url = `/api/documents/file/${doc.fileUrl.split("/").pop()}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.fileName;
    a.click();
  };

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
                    <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
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
                    <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Document Type</label>
              <Select value={uploadDocType} onValueChange={setUploadDocType}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="certificate">Certificate</SelectItem>
                  <SelectItem value="roster">Roster</SelectItem>
                  <SelectItem value="practicum_form">Practicum Form</SelectItem>
                  <SelectItem value="transcript">Transcript</SelectItem>
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
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
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
                    <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
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
                      <p className="font-medium text-sm truncate">{doc.fileName}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <Badge variant="outline" className="text-xs">{DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}</Badge>
                        <span className="text-xs text-muted-foreground">{formatFileSize(doc.fileSize)}</span>
                        <span className="text-xs text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => handleDownload(doc)} title="Download">
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(doc)} title="Delete">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
