import { useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useGetViolation, useUpdateViolation, useGeneratePocDocument } from "@/hooks/useViolations";
import {
  useListCorrectiveActions, useUpdateCorrectiveAction,
  useDeleteCorrectiveAction, useCreateViolationRetrainingAction, type CorrectiveAction,
} from "@/hooks/useCorrectiveActions";
import {
  useListViolationDocuments, useUploadViolationDocument, useViolationDocumentSignedUrl, useDeleteViolationDocument,
  type ViolationDocument,
} from "@/hooks/useViolationDocuments";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListCitationTopics } from "@/hooks/useCitationTopics";
import { useListCourses } from "@/hooks/useCourses";
import { StatusPill } from "./Violations";
import { CorrectiveActionForm, CorrectiveActionStatusBadge } from "@/components/CorrectiveActionForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, ShieldAlert, ClipboardList, FileText, Upload, Download, Trash2, Check, Plus,
  FileDown, GraduationCap, Pencil,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { humanize } from "@/lib/utils";
import { formatDateForDisplay, toLocalIsoDate } from "@/lib/dateUtils";

function SeverityBadge({ severity }: { severity: string }) {
  const className =
    severity === "high" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : severity === "moderate" ? "bg-warning text-warning-foreground hover:bg-warning/80"
    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"; // low
  return <Badge className={className} variant="outline">{humanize(severity)}</Badge>;
}

export default function ViolationDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const canDelete = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  const { data: violation, isLoading } = useGetViolation(id);
  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees();
  const { data: citationTopics } = useListCitationTopics();
  const { data: courses } = useListCourses();
  const { data: correctiveActions, isLoading: correctiveLoading } = useListCorrectiveActions({ violationId: id });
  const { data: documents, isLoading: documentsLoading } = useListViolationDocuments(id);

  const { mutate: updateViolation, isPending: updatingViolation } = useUpdateViolation();
  const { mutate: updateCorrectiveAction } = useUpdateCorrectiveAction();
  const deleteCorrectiveAction = useDeleteCorrectiveAction();
  const createRetrainingAction = useCreateViolationRetrainingAction();
  const uploadDocument = useUploadViolationDocument();
  const getSignedUrl = useViolationDocumentSignedUrl();
  const deleteDocument = useDeleteViolationDocument();
  const generatePocDocument = useGeneratePocDocument();

  const [newActionDueDate, setNewActionDueDate] = useState("");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState("");
  const [assignRetraining, setAssignRetraining] = useState(false);
  const [retrainEmployeeId, setRetrainEmployeeId] = useState("");
  const [retrainCourseId, setRetrainCourseId] = useState("");
  const [creatingAction, setCreatingAction] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [actionPendingDelete, setActionPendingDelete] = useState<CorrectiveAction | null>(null);
  const [docPendingDelete, setDocPendingDelete] = useState<ViolationDocument | null>(null);
  const [uploadLabel, setUploadLabel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const facilityName = facilities?.find((f) => f.id === violation?.facility_id)?.name;
  const topicTitle = citationTopics?.find((t) => t.id === violation?.citation_topic_id)?.title;
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));
  const facilityEmployees = (employees ?? []).filter((e) => e.facility_id === violation?.facility_id);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !violation) return;
    try {
      await uploadDocument.mutateAsync({
        file, organizationId: violation.organization_id, facilityId: violation.facility_id, violationId: violation.id,
        documentLabel: uploadLabel.trim() || undefined,
      });
      toast({ title: "Evidence uploaded" });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadLabel("");
    }
  };

  const confirmDeleteDocument = async () => {
    if (!docPendingDelete) return;
    try {
      await deleteDocument.mutateAsync(docPendingDelete);
      toast({ title: "Evidence document deleted" });
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setDocPendingDelete(null);
    }
  };

  const confirmDeleteAction = async () => {
    if (!actionPendingDelete) return;
    try {
      await deleteCorrectiveAction.mutateAsync(actionPendingDelete.id);
      toast({ title: "Corrective action deleted" });
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setActionPendingDelete(null);
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

  if (!violation) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Violation not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/app/violations">Back to Violations</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/violations"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
            <ShieldAlert className="h-7 w-7 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{violation.citation_ref ?? topicTitle ?? "Cited Violation"}</h1>
            <p className="text-muted-foreground">
              {facilityName} · Inspected {formatDateForDisplay(violation.inspection_date)}
              {violation.surveyor_name ? ` · ${violation.surveyor_name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SeverityBadge severity={violation.severity} />
          <StatusPill status={violation.status} />
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Violation Description</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm whitespace-pre-wrap">{violation.description}</p>
          <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t">
            <div><p className="text-xs text-muted-foreground">Citation Topic</p><p>{topicTitle ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">POC Due Date</p><p>{violation.poc_due_date ?? "—"}</p></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> Corrective Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {correctiveLoading ? (
            <Skeleton className="h-10" />
          ) : !correctiveActions?.length ? (
            <p className="text-sm text-muted-foreground">No corrective actions recorded.</p>
          ) : (
            <div className="space-y-2">
              {correctiveActions.map((ca) => {
                const canEdit = canManage && ca.status !== "completed" && ca.status !== "cancelled";
                return (
                  <div key={ca.id} className="p-2 rounded-lg border text-sm">
                    {editingActionId === ca.id ? (
                      <CorrectiveActionForm
                        parent={{ organizationId: violation.organization_id, facilityId: violation.facility_id, violationId: violation.id }}
                        editing={ca}
                        onDone={() => setEditingActionId(null)}
                        onCancelEdit={() => setEditingActionId(null)}
                      />
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            {ca.description}
                            {ca.course_assignment_id && (
                              <Badge variant="outline" className="text-[10px]"><GraduationCap className="h-3 w-3 mr-1" /> Retraining</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Due {ca.due_date}{ca.owner_name ? ` · ${ca.owner_name}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <CorrectiveActionStatusBadge status={ca.status} />
                          {canEdit && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => setEditingActionId(ca.id)}
                              aria-label={`Edit corrective action: ${ca.description}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canEdit && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateCorrectiveAction({ id: ca.id, status: "completed", completed_date: toLocalIsoDate() })} aria-label={`Complete corrective action: ${ca.description}`}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canDelete && !ca.course_assignment_id && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setActionPendingDelete(ca)} aria-label={`Delete corrective action: ${ca.description}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canDelete && ca.course_assignment_id && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground/40 cursor-not-allowed" disabled
                              title="Retraining-backed tasks can't be deleted -- the training assignment would remain active with no linked corrective action. Mark it completed or cancelled instead."
                              aria-label={`Cannot delete retraining corrective action: ${ca.description}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {canManage && (
            <div className="space-y-2 pt-2 border-t">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox" checked={assignRetraining}
                  onChange={(e) => setAssignRetraining(e.target.checked)}
                />
                Assign retraining to a staff member instead of a plain description
              </label>
              {assignRetraining ? (
                <div className="flex items-center gap-2">
                  <Select value={retrainEmployeeId} onValueChange={setRetrainEmployeeId}>
                    <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Select staff member" /></SelectTrigger>
                    <SelectContent>
                      {facilityEmployees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.last_name}, {e.first_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={retrainCourseId} onValueChange={setRetrainCourseId}>
                    <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Select training item" /></SelectTrigger>
                    <SelectContent>
                      {(courses ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="date" value={newActionDueDate} onChange={(e) => setNewActionDueDate(e.target.value)} className="h-9 w-40" />
                  <Button
                    size="sm"
                    disabled={!retrainEmployeeId || !retrainCourseId || !newActionDueDate || creatingAction}
                    onClick={async () => {
                      const employee = employeeById.get(retrainEmployeeId);
                      const course = (courses ?? []).find((c) => c.id === retrainCourseId);
                      if (!employee || !course?.current_version_id) {
                        toast({ title: course && !course.current_version_id ? "This training item has no published version to assign" : "Select a staff member and training item", variant: "destructive" });
                        return;
                      }
                      setCreatingAction(true);
                      try {
                        await createRetrainingAction.mutateAsync({
                          violationId: violation.id, employeeId: employee.id, courseId: course.id,
                          courseVersionId: course.current_version_id, dueDate: newActionDueDate,
                          description: `Complete "${course.title}" retraining — ${employee.first_name} ${employee.last_name}`,
                        });
                        setRetrainEmployeeId(""); setRetrainCourseId(""); setNewActionDueDate(""); setAssignRetraining(false);
                      } catch (err) {
                        toast({ title: "Failed to assign retraining", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
                      } finally {
                        setCreatingAction(false);
                      }
                    }}
                  >
                    {creatingAction ? "Assigning..." : <Plus className="h-4 w-4" />}
                  </Button>
                </div>
              ) : (
                <CorrectiveActionForm
                  parent={{ organizationId: violation.organization_id, facilityId: violation.facility_id, violationId: violation.id }}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Evidence Documents</CardTitle>
            {canManage && (
              <div className="flex items-center gap-2">
                <Input placeholder="Label (optional)" value={uploadLabel} onChange={(e) => setUploadLabel(e.target.value)} className="h-9 w-40" />
                <Button variant="outline" size="sm" disabled={uploadDocument.isPending} onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-3.5 w-3.5" /> {uploadDocument.isPending ? "Uploading..." : "Upload"}
                </Button>
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUpload} />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {documentsLoading ? (
            <Skeleton className="h-10" />
          ) : !documents?.length ? (
            <p className="text-sm text-muted-foreground">No documents uploaded. Photos, corrected policies, and training records for the follow-up visit go here.</p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  <span className="truncate flex items-center gap-1.5">
                    {doc.document_label ? `${doc.document_label} — ${doc.file_name}` : doc.file_name}
                    {doc.document_type === "poc" && <Badge variant="outline" className="text-[10px]">POC</Badge>}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(doc)} aria-label={`Download ${doc.file_name}`}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDocPendingDelete(doc)} aria-label={`Delete ${doc.file_name}`}>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileDown className="h-5 w-5" /> Plan of Correction Document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Generates a formatted Plan of Correction covering the cited violation and every corrective task recorded
            above -- regenerate any time as tasks are added or updated.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={generatePocDocument.isPending}
              onClick={() => {
                generatePocDocument.mutate(violation.id, {
                  onSuccess: (result) => window.open(result.url, "_blank", "noopener,noreferrer"),
                  onError: (e: Error) => toast({ title: "Failed to generate Plan of Correction", description: e.message, variant: "destructive" }),
                });
              }}
            >
              <FileDown className="mr-2 h-4 w-4" />
              {generatePocDocument.isPending ? "Generating..." : "Generate Plan of Correction PDF"}
            </Button>
            {canManage && violation.status === "open" && (
              <Button
                size="sm" variant="outline" disabled={updatingViolation}
                onClick={() => updateViolation({ id: violation.id, status: "poc_submitted", poc_submitted_at: new Date().toISOString() })}
              >
                Mark POC Submitted
              </Button>
            )}
            {canManage && violation.status === "poc_submitted" && (
              <Button size="sm" variant="outline" disabled={updatingViolation} onClick={() => updateViolation({ id: violation.id, status: "corrected" })}>
                Mark Corrected
              </Button>
            )}
            {canManage && violation.status === "corrected" && (
              <Button
                size="sm" variant="outline" disabled={updatingViolation}
                onClick={() => updateViolation({ id: violation.id, status: "verified", verified_at: new Date().toISOString(), verified_by_profile_id: user?.id })}
              >
                Mark Verified (Follow-Up Visit)
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!docPendingDelete} onOpenChange={(open) => !open && setDocPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Evidence Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{docPendingDelete?.file_name}"? This action cannot be undone.
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

      <AlertDialog open={!!actionPendingDelete} onOpenChange={(open) => !open && setActionPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Corrective Action</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{actionPendingDelete?.description}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteAction} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
