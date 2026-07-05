import { useRef, useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetIncident, useUpdateIncident,
  useListIncidentStaffInvolved, useAddIncidentStaffInvolved, useRemoveIncidentStaffInvolved,
  useListIncidentNotifications, useAddIncidentNotification, useCompleteIncidentNotification,
  useGenerateIncidentReportPdf,
} from "@/hooks/useIncidents";
import {
  useListCorrectiveActions, useCreateCorrectiveAction, useUpdateCorrectiveAction,
} from "@/hooks/useCorrectiveActions";
import {
  useListIncidentDocuments, useUploadIncidentDocument, useIncidentDocumentSignedUrl, useDeleteIncidentDocument,
} from "@/hooks/useIncidentDocuments";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import { useListCourses } from "@/hooks/useCourses";
import { useCreateCourseAssignment } from "@/hooks/useCourseAssignments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, AlertTriangle, Users, Bell, ClipboardList, FileText, Upload, Download, Trash2, Check, Plus,
  FileDown, GraduationCap,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function NotificationStatusBadge({ status }: { status: string }) {
  const className =
    status === "completed" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "overdue" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : "bg-warning text-warning-foreground hover:bg-warning/80"; // pending
  return <Badge className={className} variant="outline">{humanize(status)}</Badge>;
}

function CorrectiveActionStatusBadge({ status }: { status: string }) {
  const className =
    status === "completed" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "overdue" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : status === "cancelled" ? "bg-muted text-muted-foreground"
    : "bg-info text-info-foreground hover:bg-info/80"; // open/in_progress
  return <Badge className={className} variant="outline">{humanize(status)}</Badge>;
}

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  // This page is mounted at both /app/incidents/:id (org roles) and /admin/incidents/:id
  // (platform_admin, reached via Alerts deep links) -- back-navigation must match whichever
  // prefix the viewer is under, mirroring EmployeeDetail.tsx/FacilityDetail.tsx.
  const basePath = user?.role === "platform_admin" ? "/admin/incidents" : "/app/incidents";
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  // incident_staff_involved_delete and incident_documents_delete are narrower than
  // insert/update -- platform_admin or org_admin only -- so facility_manager must not be shown
  // a delete/remove action that will always fail after confirmation.
  const canDelete = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  const { data: incident, isLoading } = useGetIncident(id);
  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees();
  const { data: profiles } = useListProfiles();
  const { data: staffInvolved, isLoading: staffLoading } = useListIncidentStaffInvolved(id);
  const { data: notifications, isLoading: notificationsLoading } = useListIncidentNotifications(id);
  const { data: correctiveActions, isLoading: correctiveLoading } = useListCorrectiveActions({ incidentId: id });
  const { data: documents, isLoading: documentsLoading } = useListIncidentDocuments(id);
  const { data: courses } = useListCourses();

  const { mutate: updateIncident, isPending: updatingIncident } = useUpdateIncident();
  const { mutate: addStaff } = useAddIncidentStaffInvolved();
  const { mutate: removeStaff } = useRemoveIncidentStaffInvolved();
  const { mutate: addNotification } = useAddIncidentNotification();
  const { mutate: completeNotification, isPending: completingNotification } = useCompleteIncidentNotification();
  const { mutate: createCorrectiveAction } = useCreateCorrectiveAction();
  const { mutate: updateCorrectiveAction } = useUpdateCorrectiveAction();
  const { mutateAsync: createCourseAssignment } = useCreateCourseAssignment();
  const uploadDocument = useUploadIncidentDocument();
  const getSignedUrl = useIncidentDocumentSignedUrl();
  const deleteDocument = useDeleteIncidentDocument();
  const generateReportPdf = useGenerateIncidentReportPdf();

  const [newStaffEmployee, setNewStaffEmployee] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<"involved_party" | "witness" | "first_responder" | "reporter">("witness");
  const [newNotificationType, setNewNotificationType] = useState<"state_hotline" | "family_guardian" | "law_enforcement" | "licensing_agency" | "other">("state_hotline");
  const [newNotificationHours, setNewNotificationHours] = useState("24");
  const [newActionDescription, setNewActionDescription] = useState("");
  const [newActionDueDate, setNewActionDueDate] = useState("");
  const [assignRetraining, setAssignRetraining] = useState(false);
  const [retrainEmployeeId, setRetrainEmployeeId] = useState("");
  const [retrainCourseId, setRetrainCourseId] = useState("");
  const [creatingAction, setCreatingAction] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completeMethod, setCompleteMethod] = useState("");
  const [completeRecipient, setCompleteRecipient] = useState("");
  const [completeReference, setCompleteReference] = useState("");
  const [finalReportDate, setFinalReportDate] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const facilityName = facilities?.find((f) => f.id === incident?.facility_id)?.name;
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !incident) return;
    try {
      await uploadDocument.mutateAsync({
        file, organizationId: incident.organization_id, facilityId: incident.facility_id, incidentId: incident.id,
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

  if (!incident) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Incident not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={basePath}>Back to Incidents</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={basePath}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{humanize(incident.incident_type)}</h1>
            <p className="text-muted-foreground">{facilityName} · {new Date(incident.occurred_at).toLocaleString()}</p>
          </div>
        </div>
        {canManage && (
          <Select value={incident.status} onValueChange={(v) => updateIncident({ id: incident.id, status: v as typeof incident.status })}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["reported", "investigating", "closed"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Narrative</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm whitespace-pre-wrap">{incident.narrative}</p>
          <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t">
            {incident.resident_identifier && <div><p className="text-xs text-muted-foreground">Resident</p><p>{incident.resident_identifier}</p></div>}
            {incident.location_detail && <div><p className="text-xs text-muted-foreground">Location</p><p>{incident.location_detail}</p></div>}
          </div>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader><CardTitle>Investigation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Findings</Label>
              <Textarea
                defaultValue={incident.investigation_findings ?? ""}
                onBlur={(e) => { if (e.target.value !== (incident.investigation_findings ?? "")) updateIncident({ id: incident.id, investigation_findings: e.target.value || null }); }}
                placeholder="Investigation findings"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Root Cause</Label>
              <Textarea
                defaultValue={incident.root_cause ?? ""}
                onBlur={(e) => { if (e.target.value !== (incident.root_cause ?? "")) updateIncident({ id: incident.id, root_cause: e.target.value || null }); }}
                placeholder="Root cause analysis"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Staff Involved</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {staffLoading ? (
            <Skeleton className="h-10" />
          ) : !staffInvolved?.length ? (
            <p className="text-sm text-muted-foreground">No staff recorded.</p>
          ) : (
            <div className="space-y-2">
              {staffInvolved.map((s) => {
                const emp = employeeById.get(s.employee_id);
                return (
                  <div key={s.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                    <span>{emp ? `${emp.last_name}, ${emp.first_name}` : "Unknown"} — {humanize(s.involvement_type)}</span>
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeStaff({ id: s.id, incidentId: incident.id })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {canManage && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <Select value={newStaffEmployee} onValueChange={setNewStaffEmployee}>
                <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees?.map((e) => <SelectItem key={e.id} value={e.id}>{e.last_name}, {e.first_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={newStaffRole} onValueChange={(v) => setNewStaffRole(v as typeof newStaffRole)}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["involved_party", "witness", "first_responder", "reporter"].map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!newStaffEmployee}
                onClick={() => {
                  addStaff({ incident_id: incident.id, employee_id: newStaffEmployee, involvement_type: newStaffRole, organization_id: incident.organization_id, facility_id: incident.facility_id });
                  setNewStaffEmployee("");
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Required Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {notificationsLoading ? (
            <Skeleton className="h-10" />
          ) : !notifications?.length ? (
            <p className="text-sm text-muted-foreground">No notifications scheduled.</p>
          ) : (
            <div className="space-y-2">
              {notifications.map((n) => (
                <div key={n.id} className="rounded-lg border text-sm">
                  <div className="flex items-center justify-between p-2">
                    <div>
                      <span className="font-medium">{humanize(n.notification_type)}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {n.completed_at
                          ? `Completed ${new Date(n.completed_at).toLocaleString()}${n.notification_method ? ` via ${n.notification_method}` : ""}${n.recipient ? ` — notified: ${n.recipient}` : ""}${n.reference_number ? ` — ref# ${n.reference_number}` : ""}`
                          : `Due ${new Date(n.due_at).toLocaleString()}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <NotificationStatusBadge status={n.status} />
                      {canManage && n.status !== "completed" && (
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => {
                            if (completingId === n.id) { setCompletingId(null); return; }
                            setCompletingId(n.id); setCompleteMethod(""); setCompleteRecipient(""); setCompleteReference("");
                          }}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {completingId === n.id && (
                    <div className="p-2 pt-0 space-y-2 border-t">
                      <div className="grid grid-cols-3 gap-2">
                        <Input placeholder="Method (phone, fax, portal...)" value={completeMethod} onChange={(e) => setCompleteMethod(e.target.value)} className="h-8 text-xs" />
                        <Input placeholder="Recipient (who was notified)" value={completeRecipient} onChange={(e) => setCompleteRecipient(e.target.value)} className="h-8 text-xs" />
                        <Input placeholder="Reference / confirmation #" value={completeReference} onChange={(e) => setCompleteReference(e.target.value)} className="h-8 text-xs" />
                      </div>
                      <Button
                        size="sm"
                        disabled={completingNotification}
                        onClick={() => {
                          completeNotification({
                            id: n.id, incidentId: incident.id, completedByProfileId: user!.id,
                            notificationMethod: completeMethod.trim() || undefined,
                            recipient: completeRecipient.trim() || undefined,
                            referenceNumber: completeReference.trim() || undefined,
                          });
                          setCompletingId(null);
                        }}
                      >
                        {completingNotification ? "Saving..." : "Mark Notified"}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {canManage && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <Select value={newNotificationType} onValueChange={(v) => setNewNotificationType(v as typeof newNotificationType)}>
                <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["state_hotline", "family_guardian", "law_enforcement", "licensing_agency", "other"].map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5 shrink-0">
                <Input type="number" min={1} value={newNotificationHours} onChange={(e) => setNewNotificationHours(e.target.value)} className="h-9 w-20" />
                <span className="text-xs text-muted-foreground">hrs</span>
              </div>
              <Button
                size="sm"
                onClick={() => addNotification({
                  incident_id: incident.id, notification_type: newNotificationType,
                  due_at: new Date(Date.now() + Number(newNotificationHours || 24) * 3600_000).toISOString(),
                  organization_id: incident.organization_id, facility_id: incident.facility_id,
                })}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
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
                const owner = ca.owner_profile_id ? profileById.get(ca.owner_profile_id) : undefined;
                return (
                  <div key={ca.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                    <div>
                      <div className="flex items-center gap-1.5">
                        {ca.description}
                        {ca.course_assignment_id && (
                          <Badge variant="outline" className="text-[10px]"><GraduationCap className="h-3 w-3 mr-1" /> Retraining</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Due {ca.due_date}{owner ? ` · ${owner.first_name} ${owner.last_name}` : ca.owner_name ? ` · ${ca.owner_name}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <CorrectiveActionStatusBadge status={ca.status} />
                      {canManage && ca.status !== "completed" && ca.status !== "cancelled" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateCorrectiveAction({ id: ca.id, status: "completed", completed_date: new Date().toISOString().slice(0, 10) })}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
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
                  onChange={(e) => { setAssignRetraining(e.target.checked); setNewActionDescription(""); }}
                />
                Assign retraining to an involved staff member instead of a plain description
              </label>
              {assignRetraining ? (
                <div className="flex items-center gap-2">
                  <Select value={retrainEmployeeId} onValueChange={setRetrainEmployeeId}>
                    <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Select staff member" /></SelectTrigger>
                    <SelectContent>
                      {(staffInvolved ?? []).map((s) => {
                        const emp = employeeById.get(s.employee_id);
                        return emp ? <SelectItem key={s.employee_id} value={s.employee_id}>{emp.last_name}, {emp.first_name}</SelectItem> : null;
                      })}
                    </SelectContent>
                  </Select>
                  <Select value={retrainCourseId} onValueChange={setRetrainCourseId}>
                    <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Select course" /></SelectTrigger>
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
                        toast({ title: course && !course.current_version_id ? "This course has no published version to assign" : "Select a staff member and course", variant: "destructive" });
                        return;
                      }
                      setCreatingAction(true);
                      try {
                        const assignment = await createCourseAssignment({
                          employee_id: employee.id, course_id: course.id, course_version_id: course.current_version_id,
                          facility_id: incident.facility_id, organization_id: incident.organization_id,
                          assigned_by: user?.id ?? null, due_date: newActionDueDate,
                        });
                        createCorrectiveAction({
                          incident_id: incident.id, description: `Complete "${course.title}" retraining — ${employee.first_name} ${employee.last_name}`,
                          due_date: newActionDueDate, course_assignment_id: assignment.id,
                          owner_profile_id: user?.id ?? null, organization_id: incident.organization_id, facility_id: incident.facility_id,
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
                <div className="flex items-center gap-2">
                  <Input value={newActionDescription} onChange={(e) => setNewActionDescription(e.target.value)} placeholder="Corrective action description" className="h-9 flex-1" />
                  <Input type="date" value={newActionDueDate} onChange={(e) => setNewActionDueDate(e.target.value)} className="h-9 w-40" />
                  <Button
                    size="sm"
                    disabled={!newActionDescription.trim() || !newActionDueDate}
                    onClick={() => {
                      createCorrectiveAction({
                        incident_id: incident.id, description: newActionDescription.trim(), due_date: newActionDueDate,
                        owner_profile_id: user?.id ?? null, organization_id: incident.organization_id, facility_id: incident.facility_id,
                      });
                      setNewActionDescription("");
                      setNewActionDueDate("");
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
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
            <p className="text-sm text-muted-foreground">No documents uploaded.</p>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileDown className="h-5 w-5" /> Final Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This incident cannot be closed until a final report submission date is recorded here.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={finalReportDate || (incident.final_report_submitted_at ? incident.final_report_submitted_at.slice(0, 10) : "")}
              onChange={(e) => setFinalReportDate(e.target.value)}
              className="h-9 w-48"
              disabled={!canManage}
            />
            {canManage && (
              <Button
                size="sm" variant="outline"
                disabled={!finalReportDate || updatingIncident}
                onClick={() => {
                  updateIncident({ id: incident.id, final_report_submitted_at: new Date(finalReportDate).toISOString() });
                  setFinalReportDate("");
                }}
              >
                {incident.final_report_submitted_at ? "Update Submission Date" : "Record Submission"}
              </Button>
            )}
            {incident.final_report_submitted_at && (
              <span className="text-xs text-muted-foreground">
                Submitted {new Date(incident.final_report_submitted_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <Button
            size="sm"
            disabled={generateReportPdf.isPending}
            onClick={() => {
              generateReportPdf.mutate(incident.id, {
                onSuccess: (result) => window.open(result.url, "_blank", "noopener,noreferrer"),
                onError: (e: Error) => toast({ title: "Failed to generate report", description: e.message, variant: "destructive" }),
              });
            }}
          >
            <FileDown className="mr-2 h-4 w-4" />
            {generateReportPdf.isPending ? "Generating..." : "Generate DHS Report PDF"}
          </Button>
        </CardContent>
      </Card>

      {updatingIncident && <p className="text-xs text-muted-foreground">Saving...</p>}
    </div>
  );
}
