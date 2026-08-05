/**
 * The DME register, and the events the register was always supposed to accumulate (BACKLOG.md G10).
 *
 * The "DME inspections due" metric at the top of this page counts in-use items with no `inspected`
 * history row inside their frequency window. Nothing could write that row, so the count could only
 * rise and no control on the screen could bring it down. Recording an inspection here is what makes
 * that number mean something.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, PackageCheck, Wrench } from "lucide-react";
import {
  useRecordResidentDmeEvent,
  useResidentDmeHistory,
  useResidentDmeItems,
  useResidentDmeLastInspections,
  type ResidentDmeItem,
} from "@/hooks/useResidentDme";
import {
  DME_CONDITIONS,
  DME_EVENT_SHAPES,
  dmeEquipmentLabel,
  dmeEventIssues,
  dmeInspectionState,
  type DmeEventType,
} from "@/lib/residentDme";
import { useToast } from "@/hooks/use-toast";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface DmeResidentOption {
  id: string;
  first_name: string;
  last_name: string;
}

function HistoryList({ itemId }: { itemId: string }) {
  const history = useResidentDmeHistory(itemId);
  const rows = history.data ?? [];
  if (history.isLoading) return <p className="text-xs text-muted-foreground">Loading history…</p>;
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No events recorded against this item yet.</p>;
  }
  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.id} className="text-xs text-muted-foreground">
          {new Date(row.occurred_at).toLocaleString()} · {DME_EVENT_SHAPES[row.event_type as DmeEventType]?.label ?? row.event_type}
          {row.note ? ` — ${row.note}` : ""}
        </li>
      ))}
    </ul>
  );
}

function DmeItemRow({
  item,
  lastInspectedAt,
  residents,
}: {
  item: ResidentDmeItem;
  lastInspectedAt: string | null;
  residents: DmeResidentOption[];
}) {
  const record = useRecordResidentDmeEvent();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [eventType, setEventType] = useState<DmeEventType>("inspected");
  const [note, setNote] = useState("");
  const [newResidentId, setNewResidentId] = useState("");
  const [newCondition, setNewCondition] = useState("");

  const shape = DME_EVENT_SHAPES[eventType];
  const issues = dmeEventIssues({ eventType, note, newResidentId, newCondition });
  const inspection = dmeInspectionState(item, lastInspectedAt, new Date());

  const reset = () => { setNote(""); setNewResidentId(""); setNewCondition(""); };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {dmeEquipmentLabel(item.equipment_type)}
            {item.serial_asset_number ? ` · ${item.serial_asset_number}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {item.status.replace(/_/g, " ")} · {item.condition.replace(/_/g, " ")}
            {item.location ? ` · ${item.location}` : ""}
          </p>
          <p className={inspection.overdue ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {inspection.label}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {inspection.overdue && <Badge variant="destructive">Inspection due</Badge>}
          <Button size="sm" variant="outline" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
            Record event
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`dme-event-${item.id}`}>Event</Label>
            <Select
              value={eventType}
              onValueChange={(value) => { setEventType(value as DmeEventType); reset(); }}
            >
              <SelectTrigger id={`dme-event-${item.id}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DME_EVENT_SHAPES).map(([value, entry]) => (
                  <SelectItem key={value} value={value}>{entry.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{shape.description}</p>
          </div>

          {(eventType === "inspected" || shape.condition === null) && eventType !== "documented" && (
            <div className="space-y-1.5">
              <Label htmlFor={`dme-condition-${item.id}`}>
                Condition found{eventType === "inspected" ? "" : " (optional)"}
              </Label>
              <Select value={newCondition} onValueChange={setNewCondition}>
                <SelectTrigger id={`dme-condition-${item.id}`}><SelectValue placeholder="Leave unchanged" /></SelectTrigger>
                <SelectContent>
                  {DME_CONDITIONS.map((value) => (
                    <SelectItem key={value} value={value}>{value.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {shape.requiresResident && (
            <div className="space-y-1.5">
              <Label htmlFor={`dme-resident-${item.id}`}>Resident</Label>
              <Select value={newResidentId} onValueChange={setNewResidentId}>
                <SelectTrigger id={`dme-resident-${item.id}`}><SelectValue placeholder="Select resident" /></SelectTrigger>
                <SelectContent>
                  {residents.map((resident) => (
                    <SelectItem key={resident.id} value={resident.id}>
                      {resident.last_name}, {resident.first_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor={`dme-note-${item.id}`}>Note{shape.requiresNote ? "" : " (optional)"}</Label>
            <Textarea
              id={`dme-note-${item.id}`}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What was observed or done"
            />
          </div>

          <div className="md:col-span-2 space-y-2">
            {issues.map((issue) => <p key={issue} className="text-xs text-muted-foreground">{issue}</p>)}
            <Button
              size="sm"
              disabled={issues.length > 0 || record.isPending}
              onClick={async () => {
                try {
                  await record.mutateAsync({
                    dmeItemId: item.id,
                    eventType,
                    note: note.trim() || null,
                    newResidentId: newResidentId || null,
                    newStatus: shape.status,
                    // An explicit choice wins over the event's default: an inspection that found
                    // damage has to be able to say so.
                    newCondition: newCondition || shape.condition,
                  });
                  toast({ title: `${shape.label} recorded` });
                  reset();
                  setExpanded(false);
                } catch (error) {
                  toast({
                    title: "Recording the event was blocked",
                    description: error instanceof Error ? error.message : String(error),
                    variant: "destructive",
                  });
                }
              }}
            >
              <Wrench className="mr-2 h-4 w-4" />Record {shape.label.toLowerCase()}
            </Button>
          </div>

          <div className="md:col-span-2 border-t pt-2">
            <p className="mb-1 text-xs font-medium">Recent events</p>
            <HistoryList itemId={item.id} />
          </div>
        </div>
      )}
    </div>
  );
}

export function DmeRegisterCard({
  facilityId,
  residents,
}: {
  facilityId: string | undefined;
  residents: DmeResidentOption[];
}) {
  const items = useResidentDmeItems(facilityId);
  const inspections = useResidentDmeLastInspections(facilityId);
  const rows = items.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5" />DME register</CardTitle>
        <CardDescription>
          Equipment still in the building, and the inspection, repair and transfer events recorded against
          each item. The inspections-due count above is computed from exactly these events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!facilityId && <p className="text-sm text-muted-foreground">Choose a facility to see its register.</p>}
        {items.isError && <QueryError what="DME items" error={items.error} onRetry={() => void items.refetch()} />}
        {facilityId && items.isLoading && <p className="text-sm text-muted-foreground">Loading register…</p>}
        {facilityId && !items.isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No equipment registered at this facility.</p>
        )}
        {rows.map((item) => (
          <DmeItemRow
            key={item.id}
            item={item}
            lastInspectedAt={inspections.data?.get(item.id) ?? null}
            residents={residents}
          />
        ))}
      </CardContent>
    </Card>
  );
}
