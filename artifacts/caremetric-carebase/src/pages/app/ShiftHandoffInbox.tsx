import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, RefreshCw, UserRoundCheck } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import {
  type ShiftReportEntry,
  useConvertShiftReportEntry,
  useListShiftReportEntries,
  useResolveShiftReportEntry,
  useTriageShiftReportEntry,
} from "@/hooks/useDailyOperations";
import { useToast } from "@/hooks/use-toast";

type DialogMode = "triage" | "convert" | "resolve";

function human(value: string) {
  return value.replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function priorityVariant(priority: ShiftReportEntry["priority"]): "destructive" | "secondary" | "outline" {
  if (priority === "urgent") return "destructive";
  if (priority === "high") return "secondary";
  return "outline";
}

function destinationHref(entry: ShiftReportEntry): string | null {
  if (entry.linked_incident_id) return `/app/incidents/${entry.linked_incident_id}`;
  if (entry.linked_work_order_id) return `/app/maintenance/${entry.linked_work_order_id}`;
  if (entry.linked_change_event_id) return `/app/change-of-condition/${entry.linked_change_event_id}`;
  if (entry.linked_work_item_id) return `/app/work/${entry.linked_work_item_id}`;
  return null;
}

export default function ShiftHandoffInbox() {
  const { user } = useAuth();
  const { data: facilities } = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const [facilityId, setFacilityId] = useState("");
  const activeFacilityId = facilityId || facilities?.[0]?.id || "";
  const [includeClosed, setIncludeClosed] = useState(false);
  const entries = useListShiftReportEntries(activeFacilityId || undefined, includeClosed);
  const orgAdmins = useListProfiles({ organizationId: user?.organizationId ?? undefined, role: "org_admin" });
  const managers = useListProfiles({ organizationId: user?.organizationId ?? undefined, role: "facility_manager" });
  const owners = useMemo(() => [...(orgAdmins.data ?? []), ...(managers.data ?? [])].filter((profile) => profile.is_active), [orgAdmins.data, managers.data]);
  const [selected, setSelected] = useState<ShiftReportEntry | null>(null);
  const [mode, setMode] = useState<DialogMode>("triage");
  const [ownerId, setOwnerId] = useState("");
  const [action, setAction] = useState<"review" | "carry_forward" | "void">("review");
  const [destination, setDestination] = useState<"incident" | "maintenance" | "change_of_condition" | "work_item">("work_item");
  const [note, setNote] = useState("");
  const triage = useTriageShiftReportEntry();
  const convert = useConvertShiftReportEntry();
  const resolve = useResolveShiftReportEntry();
  const { toast } = useToast();

  const openDialog = (entry: ShiftReportEntry, nextMode: DialogMode) => {
    setSelected(entry);
    setMode(nextMode);
    setOwnerId(entry.follow_up_owner_profile_id ?? "");
    setAction("review");
    setDestination(entry.category === "maintenance" ? "maintenance" : entry.category === "fall_or_injury" ? "incident" : entry.resident_id ? "change_of_condition" : "work_item");
    setNote("");
  };

  const closeDialog = () => { setSelected(null); setNote(""); };
  const submit = async () => {
    if (!selected || note.trim().length < 5) return;
    try {
      if (mode === "triage") await triage.mutateAsync({ entryId: selected.id, ownerProfileId: ownerId || null, action, note: note.trim() });
      if (mode === "convert") await convert.mutateAsync({ entryId: selected.id, destination, reason: note.trim() });
      if (mode === "resolve") await resolve.mutateAsync({ entryId: selected.id, note: note.trim() });
      toast({ title: mode === "convert" ? "Handoff routed" : mode === "resolve" ? "Handoff resolved" : "Handoff triaged" });
      closeDialog();
    } catch (error) {
      toast({ title: "Handoff action failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };
  const pending = triage.isPending || convert.isPending || resolve.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Shift Handoff Inbox</h1><p className="text-muted-foreground">Own, route, escalate, and close shift concerns without mistaking a handoff for a formal incident.</p></div>
        <Button variant="outline" onClick={() => void entries.refetch()} disabled={entries.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${entries.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="min-w-64 space-y-2"><Label>Facility</Label><Select value={activeFacilityId} onValueChange={setFacilityId}><SelectTrigger><SelectValue placeholder="Select facility" /></SelectTrigger><SelectContent>{facilities?.map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select></div>
          <Button variant={includeClosed ? "secondary" : "outline"} onClick={() => setIncludeClosed((value) => !value)}>{includeClosed ? "Showing closed" : "Include closed"}</Button>
        </CardContent>
      </Card>

      {entries.isError ? <QueryError what="shift handoffs" error={entries.error} onRetry={() => entries.refetch()} /> : entries.isLoading ? <QueryLoading what="shift handoffs" /> : entries.data?.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-600" /><p className="font-medium">No handoffs in this view</p><p className="text-sm text-muted-foreground">Open concerns will appear here with an owner and review deadline.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">{entries.data?.map((entry) => {
          const overdue = !["resolved", "voided"].includes(entry.status) && new Date(entry.review_due_at).getTime() < Date.now();
          const href = destinationHref(entry);
          return <Card key={entry.id} className={overdue ? "border-destructive/60" : ""}>
            <CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{human(entry.category)}</CardTitle><CardDescription>{entry.facilities?.name}{entry.residents ? ` · ${entry.residents.last_name}, ${entry.residents.first_name}` : ""}</CardDescription></div><div className="flex flex-wrap gap-2"><Badge variant={priorityVariant(entry.priority)}>{human(entry.priority)}</Badge><Badge variant="outline">{human(entry.status)}</Badge>{overdue && <Badge variant="destructive"><Clock className="mr-1 h-3 w-3" />Overdue</Badge>}{entry.escalation_level > 0 && <Badge variant="destructive">Escalation {entry.escalation_level}</Badge>}</div></div></CardHeader>
            <CardContent className="space-y-3"><p className="whitespace-pre-wrap text-sm">{entry.narrative}</p><div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span>Reported {new Date(entry.created_at).toLocaleString()}</span><span>Review by {new Date(entry.review_due_at).toLocaleString()}</span><span>{entry.owner ? `Owner: ${entry.owner.first_name} ${entry.owner.last_name}` : "Unassigned"}</span></div><div className="flex flex-wrap gap-2">{!["resolved", "voided"].includes(entry.status) && <><Button size="sm" variant="outline" onClick={() => openDialog(entry, "triage")}><UserRoundCheck className="mr-1 h-4 w-4" />Triage</Button><Button size="sm" onClick={() => openDialog(entry, "convert")}><ArrowRight className="mr-1 h-4 w-4" />Route to workflow</Button><Button size="sm" variant="outline" onClick={() => openDialog(entry, "resolve")}>Resolve directly</Button></>}{href && <Button asChild size="sm" variant="link"><Link href={href}>Open linked record</Link></Button>}</div></CardContent>
          </Card>;
        })}</div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && closeDialog()}><DialogContent><DialogHeader><DialogTitle>{mode === "triage" ? "Triage handoff" : mode === "convert" ? "Route to formal workflow" : "Resolve handoff"}</DialogTitle><DialogDescription>{mode === "convert" ? "The original handoff remains linked to the new formal record and its audit trail." : "Record an accountable decision and note."}</DialogDescription></DialogHeader>
        {mode === "triage" && <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Action</Label><Select value={action} onValueChange={(value) => setAction(value as typeof action)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="review">Mark reviewed</SelectItem><SelectItem value="carry_forward">Carry forward</SelectItem><SelectItem value="void">Void duplicate/invalid</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Owner</Label><Select value={ownerId || "self"} onValueChange={(value) => setOwnerId(value === "self" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="self">Assign to me</SelectItem>{owners.map((owner) => <SelectItem key={owner.id} value={owner.id}>{owner.last_name}, {owner.first_name}</SelectItem>)}</SelectContent></Select></div></div>}
        {mode === "convert" && <div className="space-y-2"><Label>Destination</Label><Select value={destination} onValueChange={(value) => setDestination(value as typeof destination)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="incident">Formal incident</SelectItem><SelectItem value="maintenance">Maintenance work order</SelectItem><SelectItem value="change_of_condition" disabled={!selected?.resident_id}>Change of condition</SelectItem><SelectItem value="work_item">General owned work</SelectItem></SelectContent></Select>{destination === "incident" && <p className="flex gap-2 text-xs text-amber-700"><AlertTriangle className="h-4 w-4 shrink-0" />The incident workflow will determine required notifications and investigation follow-up.</p>}</div>}
        <div className="space-y-2"><Label>Decision note</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Describe what was reviewed, routed, or completed." /></div>
        <DialogFooter><Button variant="outline" onClick={closeDialog}>Cancel</Button><Button disabled={pending || note.trim().length < 5} onClick={() => void submit()}>{pending ? "Saving…" : "Save decision"}</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}
