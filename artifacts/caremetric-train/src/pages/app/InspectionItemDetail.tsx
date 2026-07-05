import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useGetInspectionItem, useUpdateInspectionItem } from "@/hooks/useInspectionItems";
import { useListInspectionEvents, useCreateInspectionEvent } from "@/hooks/useInspectionEvents";
import { useListCorrectiveActions, useCreateCorrectiveAction, useUpdateCorrectiveAction } from "@/hooks/useCorrectiveActions";
import type { InspectionEvent } from "@/hooks/useInspectionEvents";
import { useListFacilities } from "@/hooks/useFacilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Flame, ClipboardList, Plus, Check } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function ResultBadge({ result }: { result: string }) {
  const className =
    result === "pass" ? "bg-success text-success-foreground hover:bg-success/80"
    : result === "fail" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : "bg-warning text-warning-foreground hover:bg-warning/80"; // deficiency_noted
  return <Badge className={className} variant="outline">{humanize(result)}</Badge>;
}

function EventCorrectiveActions({ event, canManage }: { event: InspectionEvent; canManage: boolean }) {
  const { user } = useAuth();
  const { data: actions } = useListCorrectiveActions({ inspectionEventId: event.id });
  const { mutate: createAction } = useCreateCorrectiveAction();
  const { mutate: updateAction } = useUpdateCorrectiveAction();
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  return (
    <div className="mt-2 pl-4 border-l-2 space-y-2">
      {actions?.map((ca) => (
        <div key={ca.id} className="flex items-center justify-between text-xs">
          <span>{ca.description} — due {ca.due_date}</span>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={ca.status === "completed" ? "bg-success text-success-foreground" : ca.status === "overdue" ? "bg-destructive text-destructive-foreground" : "bg-info text-info-foreground"}>
              {humanize(ca.status)}
            </Badge>
            {canManage && ca.status !== "completed" && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateAction({ id: ca.id, status: "completed", completed_date: new Date().toISOString().slice(0, 10) })}>
                <Check className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      ))}
      {canManage && (
        <div className="flex items-center gap-1.5">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Corrective action" className="h-7 text-xs flex-1" />
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-7 text-xs w-32" />
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            disabled={!description.trim() || !dueDate}
            onClick={() => {
              createAction({
                inspection_event_id: event.id, description: description.trim(), due_date: dueDate,
                owner_profile_id: user?.id ?? null, organization_id: event.organization_id, facility_id: event.facility_id,
              });
              setDescription("");
              setDueDate("");
            }}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function InspectionItemDetail() {
  const [, params] = useRoute("/app/inspections/:id");
  const id = params?.id;
  const { user } = useAuth();
  const { toast } = useToast();

  const canManage = ["org_admin", "facility_manager", "trainer"].includes(user?.role ?? "");

  const { data: item, isLoading } = useGetInspectionItem(id);
  const { data: facilities } = useListFacilities();
  const { data: events, isLoading: eventsLoading } = useListInspectionEvents(id);
  const { mutate: updateItem } = useUpdateInspectionItem();
  const { mutate: createEvent, isPending: creatingEvent } = useCreateInspectionEvent();

  const [showEventForm, setShowEventForm] = useState(false);
  const [performedDate, setPerformedDate] = useState(new Date().toISOString().slice(0, 10));
  const [performedBy, setPerformedBy] = useState("");
  const [result, setResult] = useState<"pass" | "fail" | "deficiency_noted">("pass");
  const [deficiencyNotes, setDeficiencyNotes] = useState("");

  const facilityName = facilities?.find((f) => f.id === item?.facility_id)?.name;

  const handleLogEvent = () => {
    if (!item || !performedBy.trim()) {
      toast({ title: "Performed by is required", variant: "destructive" });
      return;
    }
    createEvent(
      {
        inspection_item_id: item.id, performed_date: performedDate, performed_by: performedBy.trim(),
        result, deficiency_notes: result !== "pass" ? (deficiencyNotes || null) : null,
        follow_up_required: result !== "pass",
        organization_id: item.organization_id, facility_id: item.facility_id,
      },
      {
        onSuccess: () => { toast({ title: "Inspection logged" }); setShowEventForm(false); setPerformedBy(""); setDeficiencyNotes(""); setResult("pass"); },
        onError: (e: Error) => toast({ title: "Failed to log inspection", description: e.message, variant: "destructive" }),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Inspection item not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/app/inspections">Back to Inspections</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/inspections"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Flame className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{item.label}</h1>
            <p className="text-muted-foreground">{facilityName} · {item.item_type.replace(/_/g, " ")}</p>
            <div className="mt-2"><StatusBadge status={item.status} type="training" /></div>
          </div>
        </div>
        {canManage && <Button onClick={() => setShowEventForm(true)}><Plus className="mr-2 h-4 w-4" /> Log Inspection</Button>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Interval</p><p className="font-semibold">Every {item.inspection_interval_days} days</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Last Inspected</p><p className="font-semibold">{item.last_inspected_date ?? "Never"}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Next Due</p><p className="font-semibold">{item.next_due_date ?? "—"}</p></CardContent></Card>
      </div>

      {canManage && (
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Notes</Label>
              <Textarea
                defaultValue={item.notes ?? ""}
                onBlur={(e) => { if (e.target.value !== (item.notes ?? "")) updateItem({ id: item.id, notes: e.target.value || null }); }}
                placeholder="Optional notes"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> Inspection History</CardTitle>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !events?.length ? (
            <p className="text-sm text-muted-foreground">No inspections logged yet.</p>
          ) : (
            <div className="space-y-3">
              {events.map((e) => (
                <div key={e.id} className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{e.performed_date} — {e.performed_by}</p>
                      {e.deficiency_notes && <p className="text-xs text-muted-foreground mt-1">{e.deficiency_notes}</p>}
                    </div>
                    <ResultBadge result={e.result} />
                  </div>
                  {e.result !== "pass" && <EventCorrectiveActions event={e} canManage={canManage} />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEventForm} onOpenChange={(o) => { if (!o) setShowEventForm(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Log Inspection</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Date *</Label>
              <Input type="date" value={performedDate} onChange={(e) => setPerformedDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Performed By *</Label>
              <Input value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} placeholder="Staff name or vendor" className="h-9" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Result *</Label>
              <Select value={result} onValueChange={(v) => setResult(v as typeof result)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["pass", "fail", "deficiency_noted"].map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {result !== "pass" && (
              <div className="col-span-2 space-y-1.5">
                <Label className="text-[13px]">Deficiency Notes</Label>
                <Textarea value={deficiencyNotes} onChange={(e) => setDeficiencyNotes(e.target.value)} placeholder="What was found" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEventForm(false)}>Cancel</Button>
            <Button onClick={handleLogEvent} disabled={creatingEvent} className="shadow-sm">
              {creatingEvent ? "Saving..." : "Log Inspection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
