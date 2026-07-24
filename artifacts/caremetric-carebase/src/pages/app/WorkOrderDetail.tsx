import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, CheckCircle2, Clock3, DollarSign, Download, FileImage, Pause, Pencil, Play, ShieldCheck, Trash2, Upload, UserRound, Wrench } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toDateTimeLocal } from "@/lib/dateUtils";
import { humanize } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useGetInspectionItem } from "@/hooks/useInspectionItems";
import { useDeleteMaintenanceDocument,
  useGetWorkOrder,
  useListMaintenanceDocuments,
  useListWorkOrderHistory,
  useMaintenanceDocumentSignedUrl,
  useTransitionWorkOrder,
  useUpdateWorkOrderDetails,
  useUploadMaintenanceDocument,
  useVerifyWorkOrder,
  type MaintenanceDocument,
} from "@/hooks/useWorkOrders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/QueryState";

const DOCUMENT_TYPES = [
  "problem_photo", "before_photo", "after_photo", "part_invoice", "vendor_report", "warranty", "service_contract", "other",
] as const;

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function statusClass(status: string) {
  if (status === "verified") return "bg-success text-success-foreground";
  if (status === "pending_verification") return "bg-warning text-warning-foreground";
  if (status === "canceled") return "bg-muted text-muted-foreground";
  return "bg-primary/10 text-primary";
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = ["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user?.role ?? "");
  const canVerify = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const canDeleteDocuments = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const { data: order, isLoading, isError, error, refetch } = useGetWorkOrder(id);
  const { data: history } = useListWorkOrderHistory(id);
  const { data: documents } = useListMaintenanceDocuments({ workOrderId: id });
  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees({ status: "active" });
  const { data: asset } = useGetInspectionItem(order?.inspection_item_id ?? undefined);
  const updateDetails = useUpdateWorkOrderDetails();
  const transition = useTransitionWorkOrder();
  const verify = useVerifyWorkOrder();
  const uploadDocument = useUploadMaintenanceDocument();
  const openDocument = useMaintenanceDocumentSignedUrl();
  const deleteDocument = useDeleteMaintenanceDocument();

  const [showEdit, setShowEdit] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [targetStatus, setTargetStatus] = useState("");
  const [transitionNotes, setTransitionNotes] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [downtimeStarted, setDowntimeStarted] = useState("");
  const [downtimeEnded, setDowntimeEnded] = useState("");
  const [showVerify, setShowVerify] = useState(false);
  const [verificationDecision, setVerificationDecision] = useState<"verified" | "reopened">("verified");
  const [verificationNotes, setVerificationNotes] = useState("");
  const [documentType, setDocumentType] = useState<(typeof DOCUMENT_TYPES)[number]>("problem_photo");
  const [documentFile, setDocumentFile] = useState<File>();
  const [edit, setEdit] = useState({
    locationDetail: "", roomNumber: "", safetyRisk: "low", priority: "routine", protectiveAction: "",
    employeeId: "none", vendor: "", target: "", parts: "", estimatedCost: "", residentImpact: "",
  });

  useEffect(() => {
    if (!order) return;
    const localTarget = order.target_completion_at ? toDateTimeLocal(order.target_completion_at) : "";
    setEdit({
      locationDetail: order.location_detail ?? "", roomNumber: order.room_number ?? "",
      safetyRisk: order.safety_risk, priority: order.priority,
      protectiveAction: order.temporary_protective_action ?? "", employeeId: order.assigned_employee_id ?? "none",
      vendor: order.external_vendor ?? "", target: localTarget, parts: order.parts_needed ?? "",
      estimatedCost: order.estimated_cost == null ? "" : String(order.estimated_cost), residentImpact: order.resident_impact ?? "",
    });
  }, [order]);

  const employeeById = useMemo(() => new Map((employees ?? []).map((employee) => [employee.id, employee])), [employees]);
  const assignedEmployee = order?.assigned_employee_id ? employeeById.get(order.assigned_employee_id) : undefined;
  const facilityName = facilities?.find((facility) => facility.id === order?.facility_id)?.name;

  if (isLoading) return <div className="space-y-5"><Skeleton className="h-8 w-64" /><Skeleton className="h-36" /><Skeleton className="h-64" /></div>;
  if (isError) return <QueryError what="this work order" error={error} onRetry={() => void refetch()} />;
  if (!order) return <div className="py-16 text-center"><p>Work order not found.</p><Button asChild variant="outline" className="mt-4"><Link href="/app/maintenance">Back to maintenance</Link></Button></div>;

  const openTransition = (nextStatus: string) => {
    setTargetStatus(nextStatus);
    setTransitionNotes("");
    setActualCost(order.actual_cost == null ? "" : String(order.actual_cost));
    setShowTransition(true);
  };

  const submitTransition = () => {
    transition.mutate({
      id: order.id,
      targetStatus,
      notes: transitionNotes,
      actualCost: actualCost ? Number(actualCost) : null,
      downtimeStartedAt: downtimeStarted ? new Date(downtimeStarted).toISOString() : null,
      downtimeEndedAt: downtimeEnded ? new Date(downtimeEnded).toISOString() : null,
    }, {
      onSuccess: () => { setShowTransition(false); toast({ title: targetStatus === "pending_verification" ? "Work submitted for supervisor verification" : `Work order moved to ${humanize(targetStatus)}` }); },
      onError: (error: Error) => toast({ title: "Transition failed", description: error.message, variant: "destructive" }),
    });
  };

  const submitVerification = () => {
    verify.mutate({ id: order.id, decision: verificationDecision, notes: verificationNotes }, {
      onSuccess: () => { setShowVerify(false); toast({ title: verificationDecision === "verified" ? "Repair verified" : "Work returned for additional repair" }); },
      onError: (error: Error) => toast({ title: "Verification failed", description: error.message, variant: "destructive" }),
    });
  };

  const saveDetails = () => {
    updateDetails.mutate({
      id: order.id,
      locationDetail: edit.locationDetail, roomNumber: edit.roomNumber,
      safetyRisk: edit.safetyRisk, priority: edit.priority,
      temporaryProtectiveAction: edit.protectiveAction,
      assignedEmployeeId: edit.employeeId === "none" ? null : edit.employeeId,
      externalVendor: edit.vendor,
      targetCompletionAt: edit.target ? new Date(edit.target).toISOString() : null,
      partsNeeded: edit.parts,
      estimatedCost: edit.estimatedCost ? Number(edit.estimatedCost) : null,
      residentImpact: edit.residentImpact,
    }, {
      onSuccess: () => { setShowEdit(false); toast({ title: "Work-order details updated" }); },
      onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }),
    });
  };

  const upload = () => {
    if (!documentFile) return;
    uploadDocument.mutate({
      file: documentFile,
      organizationId: order.organization_id,
      facilityId: order.facility_id,
      workOrderId: order.id,
      documentType,
    }, {
      onSuccess: () => { setDocumentFile(undefined); toast({ title: "Maintenance documentation uploaded" }); },
      onError: (error: Error) => toast({ title: "Upload failed", description: error.message, variant: "destructive" }),
    });
  };

  const viewDocument = (doc: MaintenanceDocument) => {
    openDocument.mutate(doc, {
      onSuccess: (url) => window.open(url, "_blank", "noopener,noreferrer"),
      onError: (error: Error) => toast({ title: "Could not open document", description: error.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm"><Link href="/app/maintenance"><ArrowLeft className="mr-2 h-4 w-4" /> Back to maintenance</Link></Button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-bold">{order.work_order_number}</h1><Badge className={statusClass(order.status)} variant="outline">{humanize(order.status)}</Badge></div>
          <p className="mt-1 text-muted-foreground">{facilityName} · {asset?.label ?? order.room_number ?? order.location_detail ?? "General environmental work"}</p>
          <p className="mt-3 max-w-3xl text-lg">{order.problem_description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && !["verified","canceled"].includes(order.status) && <Button variant="outline" onClick={() => setShowEdit(true)}><Pencil className="mr-2 h-4 w-4" /> Edit details</Button>}
          {canManage && order.status === "open" && <Button onClick={() => openTransition(order.assigned_employee_id ? "assigned" : "in_progress")}><Play className="mr-2 h-4 w-4" /> Start work</Button>}
          {canManage && order.status === "assigned" && <Button onClick={() => openTransition("in_progress")}><Play className="mr-2 h-4 w-4" /> Begin repair</Button>}
          {canManage && order.status === "in_progress" && <><Button variant="outline" onClick={() => openTransition("on_hold")}><Pause className="mr-2 h-4 w-4" /> Put on hold</Button><Button onClick={() => openTransition("pending_verification")}><CheckCircle2 className="mr-2 h-4 w-4" /> Complete repair</Button></>}
          {canManage && order.status === "on_hold" && <Button onClick={() => openTransition("in_progress")}><Play className="mr-2 h-4 w-4" /> Resume work</Button>}
          {canVerify && order.status === "pending_verification" && <Button onClick={() => setShowVerify(true)}><ShieldCheck className="mr-2 h-4 w-4" /> Supervisor verification</Button>}
        </div>
      </div>

      {order.status === "pending_verification" && <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4"><ShieldCheck className="mt-0.5 h-5 w-5 text-warning" /><div><p className="font-semibold">Repair is not yet verified compliant</p><p className="text-sm text-muted-foreground">Completion is recorded, but this item remains in the supervisor verification queue until the repair and documentation are reviewed.</p></div></div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="pt-5"><div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Risk / priority</div><p className="mt-2 font-semibold">{humanize(order.safety_risk)} · {humanize(order.priority)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="flex items-center gap-2 text-sm text-muted-foreground"><UserRound className="h-4 w-4" /> Assigned to</div><p className="mt-2 font-semibold">{assignedEmployee ? `${assignedEmployee.first_name} ${assignedEmployee.last_name}` : order.external_vendor || "Unassigned"}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" /> Target completion</div><p className="mt-2 font-semibold">{formatTimestamp(order.target_completion_at)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="flex items-center gap-2 text-sm text-muted-foreground"><DollarSign className="h-4 w-4" /> Cost</div><p className="mt-2 font-semibold">{order.actual_cost != null ? `$${Number(order.actual_cost).toFixed(2)} actual` : order.estimated_cost != null ? `$${Number(order.estimated_cost).toFixed(2)} estimated` : "Not recorded"}</p></CardContent></Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Repair record</CardTitle></CardHeader><CardContent className="grid gap-5 md:grid-cols-2">
            <div><p className="text-xs font-medium uppercase text-muted-foreground">Temporary protective action</p><p className="mt-1 whitespace-pre-wrap text-sm">{order.temporary_protective_action || "None recorded"}</p></div>
            <div><p className="text-xs font-medium uppercase text-muted-foreground">Resident impact</p><p className="mt-1 whitespace-pre-wrap text-sm">{order.resident_impact || "None recorded"}</p></div>
            <div><p className="text-xs font-medium uppercase text-muted-foreground">Parts needed</p><p className="mt-1 whitespace-pre-wrap text-sm">{order.parts_needed || "None recorded"}</p></div>
            <div><p className="text-xs font-medium uppercase text-muted-foreground">Downtime</p><p className="mt-1 text-sm">{formatTimestamp(order.downtime_started_at)} to {formatTimestamp(order.downtime_ended_at)}</p></div>
            <div className="md:col-span-2"><p className="text-xs font-medium uppercase text-muted-foreground">Repair notes</p><p className="mt-1 whitespace-pre-wrap text-sm">{order.repair_notes || "Repair has not been completed."}</p></div>
            {order.verification_notes && <div className="md:col-span-2 rounded-lg border border-success/30 bg-success/5 p-3"><p className="text-xs font-medium uppercase text-muted-foreground">Supervisor verification</p><p className="mt-1 whitespace-pre-wrap text-sm">{order.verification_notes}</p><p className="mt-2 text-xs text-muted-foreground">{formatTimestamp(order.verified_at)}</p></div>}
          </CardContent></Card>

          <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileImage className="h-5 w-5" /> Photos &amp; documents</CardTitle></CardHeader><CardContent className="space-y-4">
            {canManage && !["verified","canceled"].includes(order.status) && <div className="grid items-end gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[180px_1fr_auto]"><div><Label>Documentation type</Label><Select value={documentType} onValueChange={(value) => setDocumentType(value as typeof documentType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DOCUMENT_TYPES.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div><div><Label>JPEG, PNG, WebP, or PDF</Label><Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setDocumentFile(event.target.files?.[0])} /></div><Button onClick={upload} disabled={!documentFile || uploadDocument.isPending}><Upload className="mr-2 h-4 w-4" /> Upload</Button></div>}
            {!documents?.length ? <p className="py-6 text-center text-sm text-muted-foreground">No repair documentation uploaded yet.</p> : <div className="grid gap-2 sm:grid-cols-2">{documents.map((doc) => <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{doc.file_name}</p><p className="text-xs text-muted-foreground">{humanize(doc.document_type)} · {new Date(doc.created_at).toLocaleDateString()}</p></div><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => viewDocument(doc)}><Download className="h-4 w-4" /></Button>{canDeleteDocuments && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteDocument.mutate(doc)}><Trash2 className="h-4 w-4" /></Button>}</div></div>)}</div>}
          </CardContent></Card>
        </div>

        <Card><CardHeader><CardTitle>Lifecycle history</CardTitle></CardHeader><CardContent><div className="space-y-4">{history?.map((event, index) => <div key={event.id} className="relative pl-6"><span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />{index < history.length - 1 && <span className="absolute bottom-[-18px] left-[4px] top-4 w-px bg-border" />}<p className="text-sm font-semibold">{humanize(event.event_type)}</p><p className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</p>{event.notes && <p className="mt-1 text-sm">{event.notes}</p>}</div>)}</div></CardContent></Card>
      </div>

      <Dialog open={showTransition} onOpenChange={setShowTransition}><DialogContent><DialogHeader><DialogTitle>{targetStatus === "pending_verification" ? "Complete repair and submit for verification" : `Move to ${humanize(targetStatus)}`}</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div><Label>{targetStatus === "pending_verification" ? "Repair notes *" : "Transition notes *"}</Label><Textarea value={transitionNotes} onChange={(e) => setTransitionNotes(e.target.value)} /></div>{targetStatus === "pending_verification" && <><div><Label>Actual cost</Label><Input type="number" min="0" step="0.01" value={actualCost} onChange={(e) => setActualCost(e.target.value)} /></div><div className="grid grid-cols-2 gap-3"><div><Label>Downtime started</Label><Input type="datetime-local" value={downtimeStarted} onChange={(e) => setDowntimeStarted(e.target.value)} /></div><div><Label>Downtime ended</Label><Input type="datetime-local" value={downtimeEnded} onChange={(e) => setDowntimeEnded(e.target.value)} /></div></div><p className="rounded-md bg-warning/10 p-3 text-sm">This records repair completion but does not mark the item compliant. A supervisor must verify it next.</p></>}</div><DialogFooter><Button variant="outline" onClick={() => setShowTransition(false)}>Cancel</Button><Button onClick={submitTransition} disabled={transition.isPending || transitionNotes.trim().length < 3}>{targetStatus === "pending_verification" ? "Submit for verification" : "Save transition"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={showVerify} onOpenChange={setShowVerify}><DialogContent><DialogHeader><DialogTitle>Supervisor verification</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div><Label>Decision</Label><Select value={verificationDecision} onValueChange={(value) => setVerificationDecision(value as typeof verificationDecision)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="verified">Repair verified</SelectItem><SelectItem value="reopened">Return for additional work</SelectItem></SelectContent></Select></div><div><Label>Verification findings *</Label><Textarea value={verificationNotes} onChange={(e) => setVerificationNotes(e.target.value)} placeholder="Describe what was inspected and why the repair is accepted or returned" /></div>{verificationDecision === "verified" && asset && <p className="rounded-md bg-success/10 p-3 text-sm">Verification will create a passing follow-up inspection for {asset.label} and restore its compliance status.</p>}</div><DialogFooter><Button variant="outline" onClick={() => setShowVerify(false)}>Cancel</Button><Button onClick={submitVerification} disabled={verify.isPending || verificationNotes.trim().length < 3}>{verificationDecision === "verified" ? "Verify repair" : "Reopen work order"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={showEdit} onOpenChange={setShowEdit}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto"><DialogHeader><DialogTitle>Edit work-order details</DialogTitle></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2"><div><Label>Safety risk</Label><Select value={edit.safetyRisk} onValueChange={(value) => setEdit({ ...edit, safetyRisk: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["none","low","moderate","high","immediate_danger"].map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div><div><Label>Priority</Label><Select value={edit.priority} onValueChange={(value) => setEdit({ ...edit, priority: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["routine","urgent","emergency"].map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div><div><Label>Assigned employee</Label><Select value={edit.employeeId} onValueChange={(value) => setEdit({ ...edit, employeeId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{employees?.filter((employee) => employee.facility_id === order.facility_id).map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name}</SelectItem>)}</SelectContent></Select></div><div><Label>External vendor</Label><Input value={edit.vendor} onChange={(e) => setEdit({ ...edit, vendor: e.target.value })} /></div><div><Label>Room</Label><Input value={edit.roomNumber} onChange={(e) => setEdit({ ...edit, roomNumber: e.target.value })} /></div><div><Label>Location detail</Label><Input value={edit.locationDetail} onChange={(e) => setEdit({ ...edit, locationDetail: e.target.value })} /></div><div><Label>Target completion</Label><Input type="datetime-local" value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value })} /></div><div><Label>Estimated cost</Label><Input type="number" min="0" step="0.01" value={edit.estimatedCost} onChange={(e) => setEdit({ ...edit, estimatedCost: e.target.value })} /></div><div className="sm:col-span-2"><Label>Temporary protective action</Label><Textarea value={edit.protectiveAction} onChange={(e) => setEdit({ ...edit, protectiveAction: e.target.value })} /></div><div className="sm:col-span-2"><Label>Parts needed</Label><Textarea value={edit.parts} onChange={(e) => setEdit({ ...edit, parts: e.target.value })} /></div><div className="sm:col-span-2"><Label>Resident impact</Label><Textarea value={edit.residentImpact} onChange={(e) => setEdit({ ...edit, residentImpact: e.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button><Button onClick={saveDetails} disabled={updateDetails.isPending}>Save changes</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
