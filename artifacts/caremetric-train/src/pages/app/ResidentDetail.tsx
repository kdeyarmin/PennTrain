import { useRef, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetResident, useUpdateResident } from "@/hooks/useResidents";
import {
  useListResidentComplianceItems, useCompleteResidentComplianceItem, useLogResidentChangeOfCondition,
} from "@/hooks/useResidentComplianceItems";
import {
  useListResidentDocuments, useUploadResidentDocument, useResidentDocumentSignedUrl, useDeleteResidentDocument,
} from "@/hooks/useResidentDocuments";
import { useListResidentAssessmentForms, useStartResidentAssessmentForm } from "@/hooks/useResidentAssessmentForms";
import { useListFacilities } from "@/hooks/useFacilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, BedDouble, ClipboardList, FileText, Upload, Download, Trash2, Check, TriangleAlert, FilePenLine, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { ITEM_TYPE_LABELS, complianceStatusBadgeClassName, getComplianceFormLabel } from "@/lib/residentCompliance";
import { isDigitalFormEligible, deriveAssessmentReason } from "@/lib/residentAssessmentFormSchema";

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function ComplianceStatusBadge({ status }: { status: string }) {
  return <Badge className={complianceStatusBadgeClassName(status)} variant="outline">{humanize(status)}</Badge>;
}

export default function ResidentDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const canDelete = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  const { data: resident, isLoading } = useGetResident(id);
  const { data: facilities } = useListFacilities();
  const { data: items, isLoading: itemsLoading } = useListResidentComplianceItems(id);
  const { data: documents, isLoading: documentsLoading } = useListResidentDocuments(id);
  const { data: assessmentForms, isLoading: assessmentFormsLoading } = useListResidentAssessmentForms(id);

  const { mutate: updateResident } = useUpdateResident();
  const completeItem = useCompleteResidentComplianceItem();
  const logChangeOfCondition = useLogResidentChangeOfCondition();
  const uploadDocument = useUploadResidentDocument();
  const getSignedUrl = useResidentDocumentSignedUrl();
  const deleteDocument = useDeleteResidentDocument();
  const startAssessmentForm = useStartResidentAssessmentForm();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showChangeDialog, setShowChangeDialog] = useState(false);
  const [changeNotes, setChangeNotes] = useState("");

  const itemById = new Map((items ?? []).map((i) => [i.id, i]));

  const handleLogChangeOfCondition = () => {
    if (!resident) return;
    logChangeOfCondition.mutate(
      { residentId: resident.id, notes: changeNotes.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: "Significant change reassessment logged" });
          setShowChangeDialog(false);
          setChangeNotes("");
        },
        onError: (e: Error) => toast({ title: "Failed to log change of condition", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleCompleteInCareMetric = (item: NonNullable<typeof items>[number]) => {
    if (!resident) return;
    startAssessmentForm.mutate(
      { residentId: resident.id, reason: deriveAssessmentReason(item.item_type), complianceItemId: item.id },
      {
        onSuccess: (newForm) => navigate(`/app/residents/${resident.id}/assessment-forms/${newForm.id}`),
        onError: (e: Error) => toast({ title: "Failed to start assessment form", description: e.message, variant: "destructive" }),
      },
    );
  };

  const facility = facilities?.find((f) => f.id === resident?.facility_id);
  const facilityName = facility?.name;
  const formLabel = getComplianceFormLabel(facility?.facility_type);

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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> {formLabel} Compliance Checklist</CardTitle>
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setShowChangeDialog(true)}>
                <TriangleAlert className="mr-2 h-3.5 w-3.5" /> Log Change of Condition
              </Button>
            )}
          </div>
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
                    {item.triggered_by_item_id && itemById.get(item.triggered_by_item_id) && (
                      <p className="text-xs text-muted-foreground italic">
                        → triggered by {ITEM_TYPE_LABELS[itemById.get(item.triggered_by_item_id)!.item_type]
                          ?? humanize(itemById.get(item.triggered_by_item_id)!.item_type)} completed{" "}
                        {itemById.get(item.triggered_by_item_id)!.completed_date}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ComplianceStatusBadge status={item.status} />
                    {canManage && item.status !== "compliant" && item.status !== "not_applicable" && (
                      <>
                        {isDigitalFormEligible(item.item_type) && (
                          <Button
                            variant="outline" size="sm" className="h-7 text-xs" disabled={startAssessmentForm.isPending}
                            onClick={() => handleCompleteInCareMetric(item)}
                          >
                            <FilePenLine className="mr-1.5 h-3.5 w-3.5" /> Complete in CareMetric
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7" title="Mark complete without the digital form"
                          disabled={completeItem.isPending}
                          onClick={() => completeItem.mutate(item, {
                            onError: (e: Error) => toast({ title: "Failed to mark complete", description: e.message, variant: "destructive" }),
                          })}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showChangeDialog} onOpenChange={(o) => { setShowChangeDialog(o); if (!o) setChangeNotes(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Change of Condition</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              PA DHS requires a reassessment when a resident's condition significantly changes, but
              specifies no exact turnaround time — this schedules it as due immediately so it stays
              visible until completed.
            </p>
            <Textarea
              placeholder="Optional note (e.g. fall, ER visit 7/3)"
              value={changeNotes}
              onChange={(e) => setChangeNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChangeDialog(false)}>Cancel</Button>
            <Button onClick={handleLogChangeOfCondition} disabled={logChangeOfCondition.isPending}>
              {logChangeOfCondition.isPending ? "Logging..." : "Log Change of Condition"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FilePenLine className="h-5 w-5" /> Digital {formLabel} Forms</CardTitle>
        </CardHeader>
        <CardContent>
          {assessmentFormsLoading ? (
            <Skeleton className="h-10" />
          ) : !assessmentForms?.length ? (
            <p className="text-sm text-muted-foreground">
              No {formLabel} completed in CareMetric yet — use "Complete in CareMetric" on a checklist item above to start one.
            </p>
          ) : (
            <div className="space-y-2">
              {assessmentForms.map((f) => (
                <div key={f.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  <div>
                    <div className="flex items-center gap-1.5">
                      Version {f.version_number} — {humanize(f.reason)}
                      {f.status === "finalized"
                        ? <Badge variant="outline"><Lock className="mr-1 h-3 w-3" /> Finalized</Badge>
                        : <Badge variant="outline">Draft</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {f.status === "finalized" ? `Finalized ${new Date(f.finalized_at!).toLocaleDateString()}` : `Prepared by ${f.prepared_by_name || "—"}`}
                    </p>
                  </div>
                  <Link href={`/app/residents/${id}/assessment-forms/${f.id}`} className="text-sm text-primary hover:underline">
                    {f.status === "finalized" ? "View" : "Continue"}
                  </Link>
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
            <p className="text-sm text-muted-foreground">No documents uploaded. Completed DHS {formLabel}/DME forms go here.</p>
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
