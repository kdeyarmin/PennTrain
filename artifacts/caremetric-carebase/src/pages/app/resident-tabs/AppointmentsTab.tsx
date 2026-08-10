import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  CalendarClock, CalendarPlus, CheckCircle2, CircleDashed, ClipboardCheck, FileWarning, Plus, Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import {
  AcknowledgeNewOrdersDialog, CloseAppointmentFollowUpDialog, RecordAppointmentOutcomeDialog,
  RescheduleAppointmentDialog, ScheduleAppointmentDialog,
} from "@/components/residents/AppointmentDialogs";
import {
  useAddAppointmentPreparationItem,
  useCompleteAppointmentPreparation, useSetAppointmentPreparationItem,
} from "@/hooks/useResidentAppointmentMutations";
import {
  useResidentAppointmentPreparation, useResidentAppointments,
} from "@/hooks/useResidentAppointments";
import {
  appointmentStage, appointmentStageLabel, buildPreparationState, followUpOutstanding,
  preparationItemKindLabel, sortAppointments, transportSummary,
  type AppointmentLike, type AppointmentPreparationItemLike, type AppointmentStage,
} from "@/lib/residentAppointments";
import type { ResidentTabProps } from "./types";

const STAGE_STYLE: Record<AppointmentStage, string> = {
  upcoming: "",
  in_progress: "border-amber-500 text-amber-700 dark:text-amber-500",
  awaiting_outcome: "border-amber-500 text-amber-700 dark:text-amber-500",
  follow_up_open: "border-amber-500 text-amber-700 dark:text-amber-500",
  closed: "",
  canceled: "",
  rescheduled: "",
};

function whenLabel(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "—" : at.toLocaleString();
}

function PreparationList({
  items, canManage, disabled, onToggle,
}: {
  items: AppointmentPreparationItemLike[];
  canManage: boolean;
  disabled: boolean;
  onToggle: (item: AppointmentPreparationItemLike) => void;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing was listed to prepare for this appointment.</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2 text-sm">
          <button
            type="button"
            className="mt-0.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={`${item.ready ? "Mark not ready" : "Mark ready"}: ${item.label}`}
            aria-pressed={item.ready}
            disabled={!canManage || disabled}
            onClick={() => onToggle(item)}
          >
            {item.ready
              ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              : <CircleDashed className="h-4 w-4 text-muted-foreground" />}
          </button>
          <span className={item.ready ? "text-muted-foreground line-through" : ""}>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {preparationItemKindLabel(item.item_kind)}
            </span>{" "}
            {item.label}
            {!item.required && <span className="ml-1 text-xs text-muted-foreground">(optional)</span>}
            {item.ready && item.ready_at && (
              <span className="ml-1 text-xs text-muted-foreground">· ready {whenLabel(item.ready_at)}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AddPreparationItem({ appointmentId, residentId }: { appointmentId: string; residentId: string }) {
  const { toast } = useToast();
  const addItem = useAddAppointmentPreparationItem(residentId);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"document" | "equipment" | "task">("task");

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => { setOpen(true); setLabel(""); }}>
        <Plus className="mr-1 h-3 w-3" />Add something to prepare
      </Button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded border p-2">
      <div className="flex flex-wrap gap-2">
        <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Prepare kind"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="document">Document</SelectItem>
            <SelectItem value="equipment">Equipment</SelectItem>
            <SelectItem value="task">Task</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="h-8 flex-1 text-xs"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Current medication list"
          aria-label="What needs preparing"
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm" className="h-7 text-xs"
          disabled={addItem.isPending || label.trim().length < 2}
          onClick={() => addItem.mutate(
            { appointmentId, itemKind: kind, label: label.trim() },
            {
              onSuccess: () => { setOpen(false); setLabel(""); toast({ title: "Added to the preparation list" }); },
              onError: (error) => toast({ title: "Could not add it", description: errorText(error), variant: "destructive" }),
            },
          )}
        >
          Add
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * The Appointments tab (program plan item 1).
 *
 * This is the last tab in the Resident 360 request that had never been built. The table and its two
 * RPCs shipped in 20260714100000 and no code ever touched them; `tabs.ts` recorded that as a planned
 * tab rather than pretending otherwise. Migration 20260804110000 added the three missing write paths
 * -- preparation readiness, order acknowledgement, and follow-up closure -- and this renders them.
 *
 * The screen is ordered by what a person is trying to answer: is this resident ready to leave, and
 * is anything still owed from the last time they went out.
 */
export default function AppointmentsTab({ resident, canManage }: ResidentTabProps) {
  const { toast } = useToast();
  const appointmentsQuery = useResidentAppointments(resident.id);
  const appointments = useMemo(
    () => sortAppointments((appointmentsQuery.data ?? []) as AppointmentLike[]),
    [appointmentsQuery.data],
  );
  const preparationQuery = useResidentAppointmentPreparation(appointments.map((row) => row.id));
  const setItem = useSetAppointmentPreparationItem(resident.id);
  const completePreparation = useCompleteAppointmentPreparation(resident.id);

  const [scheduling, setScheduling] = useState(false);
  const [recordingOutcome, setRecordingOutcome] = useState<AppointmentLike | null>(null);
  const [acknowledging, setAcknowledging] = useState<AppointmentLike | null>(null);
  const [closing, setClosing] = useState<AppointmentLike | null>(null);
  const [rescheduling, setRescheduling] = useState<AppointmentLike | null>(null);

  const itemsByAppointment = useMemo(() => {
    const map = new Map<string, AppointmentPreparationItemLike[]>();
    for (const item of preparationQuery.data ?? []) {
      const list = map.get(item.appointment_id) ?? [];
      list.push(item);
      map.set(item.appointment_id, list);
    }
    return map;
  }, [preparationQuery.data]);

  const toggleItem = async (item: AppointmentPreparationItemLike) => {
    try {
      await setItem.mutateAsync({ itemId: item.id, ready: !item.ready });
    } catch (error) {
      toast({
        title: "Could not update the preparation item",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const signOff = async (appointment: AppointmentLike) => {
    try {
      await completePreparation.mutateAsync({ appointmentId: appointment.id });
      toast({ title: "Preparation signed off" });
    } catch (error) {
      toast({
        title: "Could not sign off the preparation",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5" /> Appointments
              </CardTitle>
              <CardDescription>
                Medical appointments, what has to travel with the resident, and what came back that
                still needs acting on.
              </CardDescription>
            </div>
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setScheduling(true)}>
                <CalendarPlus className="mr-2 h-3.5 w-3.5" /> Schedule appointment
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {appointmentsQuery.isError ? (
            <QueryError
              what="this resident's appointments"
              error={appointmentsQuery.error}
              onRetry={() => void appointmentsQuery.refetch()}
            />
          ) : appointmentsQuery.isLoading ? (
            <Skeleton className="h-24" />
          ) : appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No appointments recorded for this resident.
            </p>
          ) : (
            <div className="space-y-3">
              {appointments.map((appointment) => {
                const stage = appointmentStage(appointment);
                const items = itemsByAppointment.get(appointment.id) ?? [];
                const preparation = buildPreparationState({ appointment, items });
                const outstanding = followUpOutstanding(appointment);
                const transport = transportSummary(appointment);
                const successor = appointment.rescheduled_to_appointment_id;

                return (
                  <div key={appointment.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{appointment.appointment_type}</p>
                          <Badge variant="outline" className={`text-[10px] ${STAGE_STYLE[stage]}`}>
                            {appointmentStageLabel(stage)}
                          </Badge>
                          {appointment.new_order_ack_status === "pending_review" && (
                            <Badge variant="outline" className="border-destructive text-[10px] text-destructive">
                              New orders unacknowledged
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {whenLabel(appointment.starts_at)} · {appointment.location}
                          {appointment.provider_name ? ` · ${appointment.provider_name}` : ""}
                        </p>
                        {transport && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Truck className="h-3 w-3" /> {transport}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canManage && (stage === "upcoming" || stage === "in_progress") && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setRescheduling(appointment)}>
                              Reschedule
                            </Button>
                            <Button size="sm" onClick={() => setRecordingOutcome(appointment)}>
                              Record outcome
                            </Button>
                          </>
                        )}
                        {canManage && stage === "awaiting_outcome" && (
                          <Button size="sm" onClick={() => setRecordingOutcome(appointment)}>
                            Record outcome
                          </Button>
                        )}
                        {canManage && appointment.new_order_ack_status === "pending_review" && (
                          <Button size="sm" variant="outline" onClick={() => setAcknowledging(appointment)}>
                            Acknowledge orders
                          </Button>
                        )}
                        {canManage && (stage === "awaiting_outcome" || stage === "follow_up_open") && (
                          <Button
                            size="sm" variant="outline"
                            // Disabled rather than hidden while steps remain: a person needs to see
                            // what is blocking them, not wonder where the button went. The server
                            // enforces the same gate either way.
                            disabled={outstanding.length > 0}
                            title={outstanding.length > 0
                              ? `Outstanding: ${outstanding.map((step) => step.label).join(", ")}`
                              : undefined}
                            onClick={() => setClosing(appointment)}
                          >
                            Close follow-up
                          </Button>
                        )}
                      </div>
                    </div>

                    {preparation.applicable && (
                      <div className="mt-3 rounded-md border border-dashed p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="flex items-center gap-1.5 text-sm font-medium">
                            <ClipboardCheck className="h-3.5 w-3.5" /> Before departure
                            {preparation.signedOff && (
                              <Badge variant="outline" className="text-[10px]">Signed off</Badge>
                            )}
                            {!preparation.signedOff && preparation.overdue && (
                              <Badge variant="outline" className="border-destructive text-[10px] text-destructive">
                                Departure passed
                              </Badge>
                            )}
                          </p>
                          {canManage && !preparation.signedOff && (
                            <Button
                              size="sm" variant="outline"
                              disabled={!preparation.ready || completePreparation.isPending}
                              title={preparation.ready ? undefined : "Every required item has to be ready first."}
                              onClick={() => void signOff(appointment)}
                            >
                              Sign off preparation
                            </Button>
                          )}
                        </div>
                        <div className="mt-2">
                          <PreparationList
                            items={items}
                            canManage={canManage}
                            disabled={setItem.isPending}
                            onToggle={(item) => void toggleItem(item)}
                          />
                          {/* The trigger derives preparation items from the arrays the scheduler
                              wrote, which covers what was known when the appointment was booked.
                              Anything remembered afterwards -- and it usually is -- needs this.
                              The hook existed from the start of this branch and nothing rendered
                              it, so the list was fixed at creation. */}
                          {canManage && (stage === "upcoming" || stage === "in_progress") && (
                            <AddPreparationItem
                              appointmentId={appointment.id}
                              residentId={resident.id}
                            />
                          )}
                        </div>
                      </div>
                    )}

                    {appointment.outcome_summary?.trim() && (
                      <p className="mt-2 text-sm">
                        <span className="font-medium">Outcome:</span> {appointment.outcome_summary}
                      </p>
                    )}
                    {appointment.new_order_ack_note && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Orders acknowledged {whenLabel(appointment.new_order_ack_at)} — {appointment.new_order_ack_note}
                      </p>
                    )}
                    {appointment.cancellation_reason && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {appointment.status === "rescheduled" ? "Moved" : "Cancelled"}: {appointment.cancellation_reason}
                      </p>
                    )}
                    {successor && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Replaced by a later appointment on this list.
                      </p>
                    )}

                    {outstanding.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {outstanding.map((step) => (
                          <p key={step.key} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <FileWarning className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                            <span><span className="font-medium">{step.label}.</span> {step.why}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {appointment.follow_up_work_item_id && !appointment.follow_up_completed_at && (
                      <Link
                        href={`/app/work/${appointment.follow_up_work_item_id}`}
                        className="mt-2 inline-block text-xs text-primary underline-offset-2 hover:underline"
                      >
                        Open follow-up in the work queue
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {preparationQuery.isError && (
            <div className="mt-3">
              <QueryError
                what="appointment preparation items"
                error={preparationQuery.error}
                onRetry={() => void preparationQuery.refetch()}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <ScheduleAppointmentDialog open={scheduling} onOpenChange={setScheduling} residentId={resident.id} />
      <RecordAppointmentOutcomeDialog
        appointment={recordingOutcome} residentId={resident.id}
        onOpenChange={(open) => { if (!open) setRecordingOutcome(null); }}
      />
      <AcknowledgeNewOrdersDialog
        appointment={acknowledging} residentId={resident.id}
        onOpenChange={(open) => { if (!open) setAcknowledging(null); }}
      />
      <CloseAppointmentFollowUpDialog
        appointment={closing} residentId={resident.id}
        outstanding={closing ? followUpOutstanding(closing) : []}
        onOpenChange={(open) => { if (!open) setClosing(null); }}
      />
      <RescheduleAppointmentDialog
        appointment={rescheduling} residentId={resident.id}
        onOpenChange={(open) => { if (!open) setRescheduling(null); }}
      />
    </div>
  );
}
