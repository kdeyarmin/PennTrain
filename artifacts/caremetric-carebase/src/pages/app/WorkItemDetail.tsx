import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BellOff,
  CheckCircle2,
  ExternalLink,
  FileUp,
  History,
  Link2,
  Loader2,
  MessageSquare,
  Network,
  Paperclip,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { viewablePathForRole } from "@/lib/appDomains";
import { useListProfiles } from "@/hooks/useProfiles";
import {
  useAddWorkItemComment,
  useAddWorkItemDependency,
  useApproveWorkItem,
  useGetWorkItem,
  useListWorkItems,
  useRecordWorkItemEffectiveness,
  useRemoveWorkItemDependency,
  useSetWorkItemWatching,
  useSubmitLinkedWorkItemEvidence,
  useTransitionWorkItem,
  useUpdateWorkItemAssignment,
  useUploadWorkItemEvidence,
  useWorkItemActivity,
  useWorkItemEvidenceUrl,
} from "@/hooks/useWorkItems";
import {
  sourceRouteForWorkItem,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_ITEM_STATE_LABELS,
  workQueuePathForRole,
} from "@/lib/workItemQueue";
import { QueryError } from "@/components/QueryState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function actorName(actor: { first_name: string; last_name: string } | null): string {
  return actor ? `${actor.first_name} ${actor.last_name}` : "System";
}

export default function WorkItemDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const query = useGetWorkItem(id);
  const activity = useWorkItemActivity(id);
  const { data: profiles } = useListProfiles({ organizationId: user?.organizationId ?? undefined });
  const { data: candidateDependencies } = useListWorkItems({
    organizationId: user?.organizationId ?? undefined,
  });

  const transition = useTransitionWorkItem();
  const approve = useApproveWorkItem();
  const updateAssignment = useUpdateWorkItemAssignment();
  const addComment = useAddWorkItemComment();
  const setWatching = useSetWorkItemWatching();
  const addDependency = useAddWorkItemDependency();
  const removeDependency = useRemoveWorkItemDependency();
  const uploadEvidence = useUploadWorkItemEvidence();
  const submitLinkedEvidence = useSubmitLinkedWorkItemEvidence();
  const evidenceUrl = useWorkItemEvidenceUrl();
  const recordEffectiveness = useRecordWorkItemEffectiveness();

  const [targetState, setTargetState] = useState("");
  const [transitionReason, setTransitionReason] = useState("");
  const [comment, setComment] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [priority, setPriority] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [dependencyId, setDependencyId] = useState("");
  const [dependencyType, setDependencyType] = useState("blocks");
  const [evidenceType, setEvidenceType] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [linkedRecordType, setLinkedRecordType] = useState("");
  const [linkedRecordId, setLinkedRecordId] = useState("");
  const [effectivenessResult, setEffectivenessResult] = useState("");

  const work = query.data;
  useEffect(() => {
    if (!work) return;
    setOwnerId(work.owner_profile_id);
    setPriority(work.priority);
    setDueAt(toDateTimeLocal(work.due_at));
  }, [work]);

  const isManager = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const isAuditor = user?.role === "auditor";
  const isOwner = !!work && work.owner_profile_id === user?.id;
  const canContribute = isManager || isOwner;
  const backPath = workQueuePathForRole(user?.role);
  const sourcePath = work ? viewablePathForRole(sourceRouteForWorkItem(work) ?? "", user?.role) : null;
  const isWatching = activity.data?.watchers.some(watcher => watcher.profile_id === user?.id) ?? false;
  const requiredEvidence = work?.template?.required_evidence_types ?? [];
  const submittedEvidenceTypes = new Set(activity.data?.evidence.map(evidence => evidence.evidence_type));
  const missingEvidence = requiredEvidence.filter(type => !submittedEvidenceTypes.has(type));
  const blockingDependencies = activity.data?.dependencies.filter(
    dependency => dependency.dependency_type === "blocks" && dependency.dependency?.state !== "closed",
  ) ?? [];

  const allowedTransitions = useMemo(() => {
    if (!work || ["closed", "canceled"].includes(work.state)) return [];
    const states = isManager
      ? ["open", "in_progress", "blocked", "pending_approval", "closed", "canceled"]
      : ["in_progress", "blocked", "pending_approval"];
    return states.filter(state => state !== work.state && !(state === "closed" && work.template?.approval_required));
  }, [isManager, work]);

  const notifyError = (title: string) => (error: Error) =>
    toast({ title, description: error.message, variant: "destructive" });

  if (query.isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (query.isError || !work) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={backPath}><ArrowLeft className="mr-1 h-4 w-4" /> Work queue</Link>
        </Button>
        <QueryError what="this work item" error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  }

  const saveAssignment = () => {
    if (!priority || !dueAt) return;
    updateAssignment.mutate(
      {
        workItemId: work.id,
        ownerProfileId: ownerId,
        priority,
        dueAt: new Date(dueAt).toISOString(),
      },
      {
        onSuccess: () => toast({ title: "Assignment updated" }),
        onError: notifyError("Couldn't update assignment"),
      },
    );
  };

  const changeState = () => {
    if (!targetState) return;
    transition.mutate(
      { workItemId: work.id, targetState, reason: transitionReason.trim() },
      {
        onSuccess: () => {
          toast({ title: `Work moved to ${WORK_ITEM_STATE_LABELS[targetState] ?? targetState}` });
          setTargetState("");
          setTransitionReason("");
        },
        onError: notifyError("Couldn't change status"),
      },
    );
  };

  const handleApprove = () => {
    approve.mutate(
      { workItemId: work.id, reason: transitionReason.trim() },
      {
        onSuccess: () => {
          toast({ title: "Work approved and closed" });
          setTransitionReason("");
        },
        onError: notifyError("Couldn't approve work"),
      },
    );
  };

  const handleEvidenceUpload = () => {
    if (!evidenceFile || !evidenceType.trim()) return;
    uploadEvidence.mutate(
      { workItem: work, evidenceType: evidenceType.trim(), file: evidenceFile },
      {
        onSuccess: () => {
          toast({ title: "Evidence uploaded" });
          setEvidenceFile(null);
          setEvidenceType("");
        },
        onError: notifyError("Couldn't upload evidence"),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href={backPath}><ArrowLeft className="mr-1 h-4 w-4" /> Work queue</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{work.title}</h1>
          <Badge variant="outline">{WORK_ITEM_STATE_LABELS[work.state] ?? work.state}</Badge>
          <Badge variant="outline">{WORK_ITEM_PRIORITY_LABELS[work.priority] ?? work.priority}</Badge>
          {work.escalated_at && <Badge variant="destructive">Escalated</Badge>}
        </div>
        <p className="mt-1 text-muted-foreground">
          {work.facility?.name ?? "Facility"} · {work.source_type.replace(/_/g, " ")} · Due {formatTimestamp(work.due_at)}
        </p>
      </div>

      {work.state === "blocked" && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Work is blocked</AlertTitle>
          <AlertDescription>
            {blockingDependencies.length
              ? `${blockingDependencies.length} blocking ${blockingDependencies.length === 1 ? "dependency remains" : "dependencies remain"} open.`
              : "The owner marked this work blocked. Review comments and update the status when the blocker clears."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Work details</CardTitle>
              <CardDescription>Source, ownership, recurrence, and effectiveness requirements.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {work.description && <p className="whitespace-pre-wrap">{work.description}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <div><p className="text-xs uppercase text-muted-foreground">Owner</p><p>{work.owner ? `${work.owner.first_name} ${work.owner.last_name}` : "Unassigned"}</p></div>
                <div><p className="text-xs uppercase text-muted-foreground">Template</p><p>{work.template?.name ?? "Source-created work"}</p></div>
                <div><p className="text-xs uppercase text-muted-foreground">Recurrence</p><p>{work.recurrence_key ? `${work.recurrence_key} · #${work.recurrence_number}` : "Not recurring"}</p></div>
                <div><p className="text-xs uppercase text-muted-foreground">Effectiveness review due</p><p>{formatTimestamp(work.effectiveness_review_due_at)}</p></div>
              </div>
              {work.root_cause && <div><p className="text-xs uppercase text-muted-foreground">Root cause</p><p className="whitespace-pre-wrap">{work.root_cause}</p></div>}
              {sourcePath && (
                <Button asChild variant="outline" size="sm">
                  <Link href={sourcePath}><ExternalLink className="mr-2 h-4 w-4" /> Open source record</Link>
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Paperclip className="h-5 w-5" /> Evidence</CardTitle>
              <CardDescription>Upload a file or link an existing governed record. Required evidence gates closure.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {requiredEvidence.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {requiredEvidence.map(type => (
                    <Badge key={type} variant={submittedEvidenceTypes.has(type) ? "default" : "outline"}>
                      {submittedEvidenceTypes.has(type) ? "Received: " : "Required: "}{type.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              )}
              {activity.data?.evidence.length ? (
                <div className="divide-y rounded-md border">
                  {activity.data.evidence.map(evidence => (
                    <div key={evidence.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <div>
                        <p className="font-medium">{evidence.evidence_type.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted-foreground">
                          {evidence.storage_path?.split("/").at(-1) ?? `${evidence.linked_record_type} record`} · {formatTimestamp(evidence.created_at)}
                        </p>
                      </div>
                      {evidence.storage_path ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => evidenceUrl.mutate(evidence, {
                            onSuccess: url => window.open(url, "_blank", "noopener,noreferrer"),
                            onError: notifyError("Couldn't open evidence"),
                          })}
                        >
                          Open
                        </Button>
                      ) : (
                        <Badge variant="outline"><Link2 className="mr-1 h-3 w-3" /> Linked</Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No evidence submitted yet.</p>}

              {canContribute && (
                <div className="grid gap-4 border-t pt-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <Label>Upload evidence</Label>
                    <Select value={evidenceType} onValueChange={setEvidenceType}>
                      <SelectTrigger><SelectValue placeholder="Evidence type" /></SelectTrigger>
                      <SelectContent>
                        {requiredEvidence.map(type => <SelectItem key={type} value={type}>{type.replace(/_/g, " ")}</SelectItem>)}
                        <SelectItem value="supporting_document">Supporting document</SelectItem>
                        <SelectItem value="photograph">Photograph</SelectItem>
                        <SelectItem value="completion_record">Completion record</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input type="file" onChange={event => setEvidenceFile(event.target.files?.[0] ?? null)} />
                    <Button onClick={handleEvidenceUpload} disabled={!evidenceFile || !evidenceType || uploadEvidence.isPending}>
                      <FileUp className="mr-2 h-4 w-4" /> {uploadEvidence.isPending ? "Uploading..." : "Upload"}
                    </Button>
                  </div>
                  <div className="space-y-3">
                    <Label>Link governed record</Label>
                    <Input value={linkedRecordType} onChange={event => setLinkedRecordType(event.target.value)} placeholder="Record type, e.g. incident" />
                    <Input value={linkedRecordId} onChange={event => setLinkedRecordId(event.target.value)} placeholder="Record UUID" />
                    <Input value={evidenceType} onChange={event => setEvidenceType(event.target.value)} placeholder="Evidence type" />
                    <Button
                      variant="outline"
                      disabled={!linkedRecordType.trim() || !linkedRecordId || !evidenceType.trim() || submitLinkedEvidence.isPending}
                      onClick={() => submitLinkedEvidence.mutate({
                        workItemId: work.id,
                        evidenceType: evidenceType.trim(),
                        linkedRecordType: linkedRecordType.trim(),
                        linkedRecordId,
                      }, {
                        onSuccess: () => {
                          toast({ title: "Record linked as evidence" });
                          setLinkedRecordType("");
                          setLinkedRecordId("");
                          setEvidenceType("");
                        },
                        onError: notifyError("Couldn't link evidence"),
                      })}
                    >
                      <Link2 className="mr-2 h-4 w-4" /> Link record
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Network className="h-5 w-5" /> Dependencies</CardTitle>
              <CardDescription>Blocking dependencies prevent closure until the related work closes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activity.data?.dependencies.length ? (
                <div className="space-y-2">
                  {activity.data.dependencies.map(dependency => (
                    <div key={dependency.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                      <div>
                        <Link href={`${backPath}/${dependency.dependency?.id}`} className="font-medium hover:underline">
                          {dependency.dependency?.title ?? "Unavailable work item"}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {dependency.dependency_type.replace(/_/g, " ")} · {WORK_ITEM_STATE_LABELS[dependency.dependency?.state ?? ""] ?? dependency.dependency?.state}
                        </p>
                      </div>
                      {isManager && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeDependency.mutate(dependency.id, {
                            onError: notifyError("Couldn't remove dependency"),
                          })}
                          aria-label="Remove dependency"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No dependencies.</p>}
              {isManager && (
                <div className="grid gap-2 border-t pt-4 sm:grid-cols-[1fr_160px_auto]">
                  <Select value={dependencyId} onValueChange={setDependencyId}>
                    <SelectTrigger><SelectValue placeholder="Select related work" /></SelectTrigger>
                    <SelectContent>
                      {candidateDependencies?.filter(candidate => candidate.id !== work.id).map(candidate => (
                        <SelectItem key={candidate.id} value={candidate.id}>{candidate.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={dependencyType} onValueChange={setDependencyType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blocks">Blocks</SelectItem>
                      <SelectItem value="relates_to">Relates to</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    disabled={!dependencyId || addDependency.isPending}
                    onClick={() => addDependency.mutate({
                      workItemId: work.id,
                      dependsOnWorkItemId: dependencyId,
                      dependencyType,
                    }, {
                      onSuccess: () => {
                        toast({ title: "Dependency added" });
                        setDependencyId("");
                      },
                      onError: notifyError("Couldn't add dependency"),
                    })}
                  >
                    Add
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" /> Comments</CardTitle>
              <CardDescription>Internal collaboration attached to this work item.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canContribute && (
                <div className="space-y-2">
                  <Textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Add a progress note, blocker, or handoff..." />
                  <Button
                    disabled={!comment.trim() || addComment.isPending}
                    onClick={() => addComment.mutate({ workItemId: work.id, body: comment.trim() }, {
                      onSuccess: () => {
                        toast({ title: "Comment added" });
                        setComment("");
                      },
                      onError: notifyError("Couldn't add comment"),
                    })}
                  >
                    Add comment
                  </Button>
                </div>
              )}
              {activity.data?.comments.length ? activity.data.comments.map(entry => (
                <div key={entry.id} className="border-t pt-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <p className="font-medium">{actorName(entry.author)}</p>
                    <span className="text-xs text-muted-foreground">{formatTimestamp(entry.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{entry.body}</p>
                </div>
              )) : <p className="text-sm text-muted-foreground">No comments yet.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Immutable history</CardTitle>
              <CardDescription>Append-only record of creation, assignment, evidence, transitions, approvals, and reviews.</CardDescription>
            </CardHeader>
            <CardContent>
              {activity.isError ? (
                <QueryError what="work item activity" error={activity.error} onRetry={() => activity.refetch()} />
              ) : activity.data?.history.length ? (
                <div className="space-y-3">
                  {activity.data.history.map(event => (
                    <div key={event.id} className="flex justify-between gap-4 border-b pb-3 last:border-0">
                      <div>
                        <p className="text-sm font-medium">
                          {event.event_type.replace(/_/g, " ")}
                          {event.prior_state !== event.resulting_state && event.resulting_state
                            ? ` → ${WORK_ITEM_STATE_LABELS[event.resulting_state] ?? event.resulting_state}`
                            : ""}
                        </p>
                        <p className="text-sm text-muted-foreground">{event.reason}</p>
                        <p className="text-xs text-muted-foreground">{actorName(event.actor)}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatTimestamp(event.occurred_at)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No history is available.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Watchers</CardTitle>
              <CardDescription>Followers can return to this work from their queue.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {activity.data?.watchers.map(watcher => (
                  <Badge key={watcher.id} variant="secondary">
                    <UserRound className="mr-1 h-3 w-3" /> {actorName(watcher.profile)}
                  </Badge>
                ))}
                {!activity.data?.watchers.length && <p className="text-sm text-muted-foreground">No watchers.</p>}
              </div>
              {!isAuditor && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={setWatching.isPending}
                  onClick={() => setWatching.mutate({ workItemId: work.id, watching: !isWatching }, {
                    onError: notifyError("Couldn't update watcher"),
                  })}
                >
                  {isWatching ? <BellOff className="mr-2 h-4 w-4" /> : <Bell className="mr-2 h-4 w-4" />}
                  {isWatching ? "Stop watching" : "Watch"}
                </Button>
              )}
            </CardContent>
          </Card>

          {isManager && (
            <Card>
              <CardHeader>
                <CardTitle>Assignment</CardTitle>
                <CardDescription>Set the accountable owner, priority, and deadline.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Owner</Label>
                  <Select value={ownerId ?? "unassigned"} onValueChange={value => setOwnerId(value === "unassigned" ? null : value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {profiles?.filter(profile => profile.is_active).map(profile => (
                        <SelectItem key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WORK_ITEM_PRIORITIES.map(value => (
                        <SelectItem key={value} value={value}>{WORK_ITEM_PRIORITY_LABELS[value]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Due date</Label>
                  <Input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} />
                </div>
                <Button onClick={saveAssignment} disabled={!priority || !dueAt || updateAssignment.isPending}>
                  {updateAssignment.isPending ? "Saving..." : "Save assignment"}
                </Button>
              </CardContent>
            </Card>
          )}

          {canContribute && !["closed", "canceled"].includes(work.state) && (
            <Card>
              <CardHeader>
                <CardTitle>Status and approval</CardTitle>
                <CardDescription>
                  Owners may report progress or submit for approval. Managers control closure and approval.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {allowedTransitions.length > 0 && (
                  <Select value={targetState} onValueChange={setTargetState}>
                    <SelectTrigger><SelectValue placeholder="Select new status" /></SelectTrigger>
                    <SelectContent>
                      {allowedTransitions.map(state => (
                        <SelectItem key={state} value={state}>{WORK_ITEM_STATE_LABELS[state]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Textarea
                  value={transitionReason}
                  onChange={event => setTransitionReason(event.target.value)}
                  placeholder="Reason for this decision (required)"
                />
                {targetState && (
                  <Button onClick={changeState} disabled={transitionReason.trim().length < 5 || transition.isPending}>
                    {transition.isPending ? "Saving..." : "Change status"}
                  </Button>
                )}
                {isManager && work.state === "pending_approval" && work.template?.approval_required && (
                  <div className="space-y-2 border-t pt-3">
                    {(missingEvidence.length > 0 || blockingDependencies.length > 0) && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Approval requirements remain</AlertTitle>
                        <AlertDescription>
                          {missingEvidence.length > 0 && `Missing evidence: ${missingEvidence.join(", ")}. `}
                          {blockingDependencies.length > 0 && `${blockingDependencies.length} blocking dependencies remain open.`}
                        </AlertDescription>
                      </Alert>
                    )}
                    <Button
                      onClick={handleApprove}
                      disabled={transitionReason.trim().length < 5 || missingEvidence.length > 0 || blockingDependencies.length > 0 || approve.isPending}
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {approve.isPending ? "Approving..." : "Approve and close"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {isManager && work.state === "closed" && work.effectiveness_review_due_at && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /> Effectiveness review</CardTitle>
                <CardDescription>
                  Due {formatTimestamp(work.effectiveness_review_due_at)}. Record whether remediation remained effective.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {work.effectiveness_result ? (
                  <p className="whitespace-pre-wrap text-sm">{work.effectiveness_result}</p>
                ) : (
                  <>
                    <Textarea value={effectivenessResult} onChange={event => setEffectivenessResult(event.target.value)} placeholder="Review result and follow-up decision..." />
                    <Button
                      disabled={effectivenessResult.trim().length < 5 || recordEffectiveness.isPending}
                      onClick={() => recordEffectiveness.mutate({
                        workItemId: work.id,
                        result: effectivenessResult.trim(),
                      }, {
                        onSuccess: () => {
                          toast({ title: "Effectiveness review recorded" });
                          setEffectivenessResult("");
                        },
                        onError: notifyError("Couldn't record effectiveness review"),
                      })}
                    >
                      Record review
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
