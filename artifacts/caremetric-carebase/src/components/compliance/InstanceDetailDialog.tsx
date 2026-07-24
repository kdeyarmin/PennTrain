import { useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import {
  getComplianceEvidenceUrl,
  useAddComplianceNote,
  useAssignComplianceInstance,
  useComplianceRequirementDetail,
  useRemoveComplianceEvidence,
  useTransitionComplianceInstance,
  useUploadComplianceEvidence,
  type ComplianceDocument,
  type InstanceAction,
} from "@/hooks/useComplianceRequirements";
import {
  categoryLabel, chapterLabel, effectiveStatus, recurrenceLabel, statusBadgeClassName, statusLabel,
} from "@/lib/complianceCommandCenter";
import { formatDateForDisplay, formatDueDistance } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Paperclip, Trash2, Upload } from "lucide-react";

const UNASSIGNED = "__unassigned__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirementId: string | undefined;
  instanceId: string | undefined;
  canManage: boolean;
}

interface ActionDef {
  action: InstanceAction;
  label: string;
  requiresNote?: boolean;
  variant?: "default" | "outline" | "destructive";
}

function actionsForStatus(status: string, requiresReview: boolean): ActionDef[] {
  switch (status) {
    case "not_started":
    case "in_progress":
    case "overdue":
      return [
        ...(status !== "in_progress" ? [{ action: "start" as const, label: "Start", variant: "outline" as const }] : []),
        requiresReview
          ? { action: "submit_review" as const, label: "Submit for review" }
          : { action: "complete" as const, label: "Mark complete" },
        { action: "mark_not_applicable" as const, label: "Not applicable", requiresNote: true, variant: "outline" as const },
        { action: "approve_exception" as const, label: "Approve exception", requiresNote: true, variant: "outline" as const },
      ];
    case "awaiting_review":
      return [
        { action: "approve_review" as const, label: "Approve & complete" },
        { action: "reopen" as const, label: "Send back", requiresNote: true, variant: "outline" as const },
      ];
    case "complete":
    case "exception_approved":
    case "not_applicable":
      return [{ action: "reopen" as const, label: "Reopen", requiresNote: true, variant: "outline" as const }];
    default:
      return [];
  }
}

export function InstanceDetailDialog({ open, onOpenChange, requirementId, instanceId, canManage }: Props) {
  const { toast } = useToast();
  const { data: detail, isLoading } = useComplianceRequirementDetail(open ? requirementId : undefined);
  const { data: facilities } = useListFacilities();
  const { data: profiles } = useListProfiles();

  const transition = useTransitionComplianceInstance();
  const assign = useAssignComplianceInstance();
  const addNote = useAddComplianceNote();
  const upload = useUploadComplianceEvidence();
  const removeDoc = useRemoveComplianceEvidence();

  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const requirement = detail?.requirement;
  const instance = useMemo(() => detail?.instances.find((i) => i.id === instanceId), [detail, instanceId]);
  const events = useMemo(
    () => (detail?.events ?? []).filter((e) => e.instance_id === instanceId || e.instance_id === null),
    [detail, instanceId],
  );
  const documents = useMemo(
    () => (detail?.documents ?? []).filter((d) => d.instance_id === instanceId),
    [detail, instanceId],
  );

  const profileName = (id: string | null | undefined): string => {
    if (!id) return "—";
    const p = profiles?.find((x) => x.id === id);
    return p ? `${p.first_name} ${p.last_name}` : "Someone";
  };
  const facilityName = facilities?.find((f) => f.id === instance?.facility_id)?.name ?? "";
  const orgProfiles = (profiles ?? []).filter((p) => p.is_active && ["org_admin", "facility_manager", "trainer"].includes(p.role));

  const status = instance ? effectiveStatus({ status: instance.status, due_date: instance.due_date }) : "not_started";
  const actions = requirement ? actionsForStatus(status, requirement.requires_review) : [];

  async function runAction(def: ActionDef) {
    if (!instance) return;
    if (def.requiresNote && !note.trim()) {
      toast({ title: "A note is required", description: `Add a note to ${def.label.toLowerCase()}.`, variant: "destructive" });
      return;
    }
    try {
      await transition.mutateAsync({ instanceId: instance.id, action: def.action, note: note.trim() || undefined });
      setNote("");
      toast({ title: "Updated" });
    } catch (e) {
      toast({ title: "Could not update", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!file || !instance) return;
    try {
      await upload.mutateAsync({ instance, file });
      toast({ title: "Evidence attached" });
    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function openDoc(doc: ComplianceDocument) {
    const url = await getComplianceEvidenceUrl(doc);
    if (url) window.open(url, "_blank", "noopener");
    else toast({ title: "Could not open file", variant: "destructive" });
  }

  async function handleAssign(profileId: string) {
    if (!instance) return;
    try {
      await assign.mutateAsync({ instanceId: instance.id, profileId: profileId === UNASSIGNED ? null : profileId });
      toast({ title: "Reassigned" });
    } catch (e) {
      toast({ title: "Could not reassign", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function handleAddNote() {
    if (!requirement || !instance || !note.trim()) return;
    try {
      await addNote.mutateAsync({ requirementId: requirement.id, instanceId: instance.id, note: note.trim() });
      setNote("");
      toast({ title: "Note added" });
    } catch (e) {
      toast({ title: "Could not add note", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="truncate">{requirement?.title ?? "Requirement occurrence"}</span>
            {instance && <Badge variant="outline" className={statusBadgeClassName(status)}>{statusLabel(status)}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !instance || !requirement ? (
          <p className="py-8 text-center text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Category</dt><dd>{categoryLabel(requirement.category)}</dd></div>
              <div><dt className="text-muted-foreground">Facility</dt><dd>{facilityName}</dd></div>
              <div><dt className="text-muted-foreground">Cadence</dt><dd>{recurrenceLabel(requirement.recurrence, requirement.custom_interval_days)}</dd></div>
              <div>
                <dt className="text-muted-foreground">Due</dt>
                <dd>{formatDateForDisplay(instance.due_date)} <span className="text-xs text-muted-foreground">· {formatDueDistance(instance.due_date)}</span></dd>
              </div>
              <div><dt className="text-muted-foreground">Regulation</dt><dd>{requirement.regulation_citation ?? chapterLabel(requirement.regulation_chapter)}</dd></div>
              <div><dt className="text-muted-foreground">Responsible</dt><dd>{profileName(instance.responsible_profile_id)}</dd></div>
            </dl>

            {requirement.description && <p className="rounded-md bg-muted/50 p-3 text-sm">{requirement.description}</p>}

            {canManage && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {actions.map((def) => (
                    <Button key={def.action} size="sm" variant={def.variant ?? "default"} disabled={transition.isPending} onClick={() => runAction(def)}>
                      {def.label}
                    </Button>
                  ))}
                </div>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Add a note (required to mark not applicable, approve an exception, reopen, or send back)"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Assign to</span>
                    <Select value={instance.responsible_profile_id ?? UNASSIGNED} onValueChange={handleAssign}>
                      <SelectTrigger className="h-8 w-52"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {orgProfiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" variant="ghost" onClick={handleAddNote} disabled={!note.trim() || addNote.isPending}>Add note only</Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="h-4 w-4" /> Evidence {requirement.requires_evidence && <span className="text-xs font-normal text-destructive">(required)</span>}</h3>
                {canManage && (
                  <>
                    <input ref={fileRef} type="file" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0])} />
                    <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
                      <Upload className="mr-1 h-3.5 w-3.5" /> {upload.isPending ? "Uploading…" : "Upload"}
                    </Button>
                  </>
                )}
              </div>
              {documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No evidence attached yet.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {documents.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <button className="flex min-w-0 items-center gap-2 text-left hover:underline" onClick={() => openDoc(doc)}>
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{doc.document_label || doc.file_name}</span>
                      </button>
                      {canManage && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeDoc.mutate(doc)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">History</h3>
              <ol className="space-y-2">
                {events.map((ev) => (
                  <li key={ev.id} className="flex gap-3 text-sm">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                    <div className="min-w-0">
                      <p>
                        <span className="font-medium">{profileName(ev.actor_profile_id)}</span>{" "}
                        {ev.event_type.replace(/_/g, " ")}
                        {ev.new_status && ev.new_status !== ev.prior_status && <> → <span className="font-medium">{statusLabel(ev.new_status)}</span></>}
                      </p>
                      {ev.note && <p className="text-muted-foreground">{ev.note}</p>}
                      <p className="text-xs text-muted-foreground">{formatDateForDisplay(ev.created_at, { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                  </li>
                ))}
                {events.length === 0 && <li className="text-sm text-muted-foreground">No history yet.</li>}
              </ol>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
