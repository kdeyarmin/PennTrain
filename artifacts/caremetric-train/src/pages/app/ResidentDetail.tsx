import { useRef } from "react";
import { useParams, Link } from "wouter";
import { useGetResident, useUpdateResident } from "@/hooks/useResidents";
import { useListResidentComplianceItems, useCompleteResidentComplianceItem } from "@/hooks/useResidentComplianceItems";
import {
  useListResidentDocuments, useUploadResidentDocument, useResidentDocumentSignedUrl, useDeleteResidentDocument,
} from "@/hooks/useResidentDocuments";
import { useListFacilities } from "@/hooks/useFacilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, BedDouble, ClipboardList, FileText, Upload, Download, Trash2, Check } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  preadmission_screening: "Preadmission Screening",
  initial_assessment_15day: "15-Day Initial Assessment",
  support_plan_30day: "30-Day Support Plan",
  annual_reassessment: "Annual Reassessment",
  medical_evaluation: "Medical Evaluation",
};

function ComplianceStatusBadge({ status }: { status: string }) {
  const className =
    status === "compliant" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "due_soon" ? "bg-warning text-warning-foreground hover:bg-warning/80"
    : status === "expired" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : status === "not_applicable" ? "bg-muted text-muted-foreground"
    : "bg-muted text-muted-foreground"; // missing
  return <Badge className={className} variant="outline">{humanize(status)}</Badge>;
}

export default function ResidentDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const canDelete = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  const { data: resident, isLoading } = useGetResident(id);
  const { data: facilities } = useListFacilities();
  const { data: items, isLoading: itemsLoading } = useListResidentComplianceItems(id);
  const { data: documents, isLoading: documentsLoading } = useListResidentDocuments(id);

  const { mutate: updateResident } = useUpdateResident();
  const completeItem = useCompleteResidentComplianceItem();
  const uploadDocument = useUploadResidentDocument();
  const getSignedUrl = useResidentDocumentSignedUrl();
  const deleteDocument = useDeleteResidentDocument();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const facilityName = facilities?.find((f) => f.id === resident?.facility_id)?.name;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !resident) return;
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

  const handleDownload = async (doc: NonNullable<typeof documents>[number]) => {
    try {
      const signedUrl = await getSignedUrl.mutateAsync(doc);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "Download failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!resident) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Resident not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/app/residents">Back to Residents</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/residents"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <BedDouble className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{resident.last_name}, {resident.first_name}</h1>
            <p className="text-muted-foreground">
              {facilityName}{resident.room ? ` · Room ${resident.room}` : ""} · Admitted {new Date(resident.admission_date).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {resident.sdcu && <Badge variant="outline">SDCU</Badge>}
          {resident.hospice && <Badge variant="outline">Hospice</Badge>}
          {canManage ? (
            <Select
              value={resident.status}
              onValueChange={(v) => updateResident({
                id: resident.id,
                status: v as typeof resident.status,
                discharge_date: v === "discharged" ? new Date().toISOString().slice(0, 10) : null,
              })}
            >
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["active", "discharged"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">{humanize(resident.status)}</Badge>
          )}
        </div>
      </div>

      {resident.status === "discharged" && resident.discharge_date && (
        <p className="text-sm text-muted-foreground">Discharged {new Date(resident.discharge_date).toLocaleDateString()}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> RASP Compliance Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {itemsLoading ? (
            <Skeleton className="h-10" />
          ) : !items?.length ? (
            <p className="text-sm text-muted-foreground">No compliance items recorded.</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  <div>
                    <div className="flex items-center gap-1.5">
                      {ITEM_TYPE_LABELS[item.item_type] ?? humanize(item.item_type)}
                      {item.renewal_interval_days != null && (
                        <Badge variant="outline" className="text-[10px]">Recurring</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Due {item.due_date ?? "—"}{item.completed_date ? ` · Completed ${item.completed_date}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ComplianceStatusBadge status={item.status} />
                    {canManage && item.status !== "compliant" && item.status !== "not_applicable" && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7" disabled={completeItem.isPending}
                        onClick={() => completeItem.mutate(item, {
                          onError: (e: Error) => toast({ title: "Failed to mark complete", description: e.message, variant: "destructive" }),
                        })}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
          {documentsLoading ? (
            <Skeleton className="h-10" />
          ) : !documents?.length ? (
            <p className="text-sm text-muted-foreground">No documents uploaded. Completed DHS RASP/DME forms go here.</p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  <span className="truncate">{doc.file_name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(doc)}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteDocument.mutate(doc)}>
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
    </div>
  );
}
