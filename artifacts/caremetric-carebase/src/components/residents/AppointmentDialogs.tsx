import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useAcknowledgeAppointmentNewOrder, useCompleteAppointmentFollowUp, useRecordAppointmentOutcome,
  useRescheduleAppointment, useScheduleAppointmentForResident,
} from "@/hooks/useResidentAppointmentMutations";
import type { AppointmentLike } from "@/lib/residentAppointments";

/**
 * The four write surfaces the Appointments tab needs, in one module so the tab's lazy chunk pulls
 * one file rather than four. Each one is a thin form over an RPC that does its own validating --
 * these dialogs disable the obvious cases and let the server's message through for the rest, rather
 * than reimplementing gates that would then drift.
 */

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Splits a textarea into trimmed, non-empty lines. One item per line is the fastest thing to type. */
function lines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function ScheduleAppointmentDialog({
  open, onOpenChange, residentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
}) {
  const { toast } = useToast();
  const schedule = useScheduleAppointmentForResident(residentId);
  const [appointmentType, setAppointmentType] = useState("");
  const [location, setLocation] = useState("");
  const [providerName, setProviderName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [expectedReturnAt, setExpectedReturnAt] = useState("");
  const [pickupAt, setPickupAt] = useState("");
  const [transportationProvider, setTransportationProvider] = useState("");
  const [vehicleIdentifier, setVehicleIdentifier] = useState("");
  const [documents, setDocuments] = useState("");
  const [equipment, setEquipment] = useState("");
  const [tasks, setTasks] = useState("");

  useEffect(() => {
    if (!open) return;
    setAppointmentType(""); setLocation(""); setProviderName(""); setStartsAt("");
    setExpectedReturnAt(""); setPickupAt(""); setTransportationProvider("");
    setVehicleIdentifier(""); setDocuments(""); setEquipment(""); setTasks("");
  }, [open]);

  const canSubmit = appointmentType.trim() && location.trim() && startsAt;

  const submit = async () => {
    try {
      await schedule.mutateAsync({
        appointmentType: appointmentType.trim(),
        location: location.trim(),
        startsAt: new Date(startsAt).toISOString(),
        expectedReturnAt: expectedReturnAt ? new Date(expectedReturnAt).toISOString() : undefined,
        pickupAt: pickupAt ? new Date(pickupAt).toISOString() : undefined,
        providerName: providerName.trim() || undefined,
        transportationProvider: transportationProvider.trim() || undefined,
        vehicleIdentifier: vehicleIdentifier.trim() || undefined,
        documentsRequired: lines(documents),
        equipmentRequired: lines(equipment),
        // Written as plain strings; the server's trigger reads both a bare string and an object with
        // a label, so the simplest thing to type is also a valid checklist entry.
        preparationChecklist: lines(tasks),
      });
      toast({ title: "Appointment scheduled" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Could not schedule the appointment", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule appointment</DialogTitle>
          <DialogDescription>
            Anything listed below becomes a preparation item that has to be marked ready before
            departure can be signed off.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="appointment-type">Appointment type</Label>
            <Input id="appointment-type" value={appointmentType} onChange={(e) => setAppointmentType(e.target.value)} placeholder="Cardiology follow-up" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appointment-location">Location</Label>
            <Input id="appointment-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Mercy Cardiology, Suite 200" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appointment-provider">Provider</Label>
            <Input id="appointment-provider" value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="Dr. Ellis" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="appointment-starts">Starts</Label>
              <Input id="appointment-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appointment-returns">Expected back</Label>
              <Input id="appointment-returns" type="datetime-local" value={expectedReturnAt} onChange={(e) => setExpectedReturnAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appointment-pickup">Pickup</Label>
              <Input id="appointment-pickup" type="datetime-local" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appointment-vehicle">Vehicle</Label>
              <Input id="appointment-vehicle" value={vehicleIdentifier} onChange={(e) => setVehicleIdentifier(e.target.value)} placeholder="Van 3" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appointment-transport">Transportation provider</Label>
            <Input id="appointment-transport" value={transportationProvider} onChange={(e) => setTransportationProvider(e.target.value)} placeholder="County Medical Transport" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appointment-documents">Documents to send (one per line)</Label>
            <Textarea id="appointment-documents" rows={3} value={documents} onChange={(e) => setDocuments(e.target.value)} placeholder={"Current medication list\nInsurance card"} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appointment-equipment">Equipment to send (one per line)</Label>
            <Textarea id="appointment-equipment" rows={2} value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder={"Portable oxygen\nWalker"} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appointment-tasks">Other preparation (one per line)</Label>
            <Textarea id="appointment-tasks" rows={2} value={tasks} onChange={(e) => setTasks(e.target.value)} placeholder={"Hold breakfast\nNotify family"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!canSubmit || schedule.isPending}>
            {schedule.isPending ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const OUTCOME_OPTIONS: { value: "attended" | "no_show" | "canceled" | "follow_up_required" | "closed"; label: string }[] = [
  { value: "attended", label: "Attended" },
  { value: "no_show", label: "Did not attend" },
  { value: "canceled", label: "Cancelled" },
  { value: "follow_up_required", label: "Attended — follow-up required" },
  { value: "closed", label: "Closed, nothing outstanding" },
];

export function RecordAppointmentOutcomeDialog({
  appointment, onOpenChange, residentId,
}: {
  appointment: AppointmentLike | null;
  onOpenChange: (open: boolean) => void;
  residentId: string;
}) {
  const { toast } = useToast();
  const record = useRecordAppointmentOutcome(residentId);
  const [status, setStatus] = useState<typeof OUTCOME_OPTIONS[number]["value"]>("attended");
  const [summary, setSummary] = useState("");
  const [followUpDueAt, setFollowUpDueAt] = useState("");
  const [newOrders, setNewOrders] = useState(false);

  useEffect(() => {
    if (!appointment) return;
    setStatus("attended");
    setSummary(appointment.outcome_summary ?? "");
    setFollowUpDueAt("");
    // An acknowledgement already granted is never offered back as a checkbox: the server keeps it
    // and this dialog cannot revoke it.
    setNewOrders(appointment.new_order_ack_status === "pending_review");
  }, [appointment]);

  const submit = async () => {
    if (!appointment) return;
    try {
      await record.mutateAsync({
        appointmentId: appointment.id,
        status,
        outcomeSummary: summary.trim() || undefined,
        followUpDueAt: followUpDueAt ? new Date(followUpDueAt).toISOString() : undefined,
        newOrderAckStatus: newOrders ? "pending_review" : "not_applicable",
      });
      toast({ title: "Outcome recorded" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Could not record the outcome", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={Boolean(appointment)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record appointment outcome</DialogTitle>
          <DialogDescription>
            {appointment ? `${appointment.appointment_type} · ${appointment.location}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="outcome-status">What happened</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger id="outcome-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OUTCOME_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="outcome-summary">Summary</Label>
            <Textarea
              id="outcome-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)}
              placeholder="What the provider said, what changed, and what the facility has to do about it."
            />
            <p className="text-xs text-muted-foreground">
              The follow-up cannot be closed without this. It is also the follow-up work item's
              description, so a blank summary produces a queue entry that says nothing.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="outcome-follow-up">Follow-up due</Label>
            <Input id="outcome-follow-up" type="datetime-local" value={followUpDueAt} onChange={(e) => setFollowUpDueAt(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
            <input
              type="checkbox" className="mt-0.5" checked={newOrders}
              onChange={(e) => setNewOrders(e.target.checked)}
            />
            <span>
              <span className="font-medium">New or changed physician orders came back</span>
              <span className="block text-xs text-muted-foreground">
                Raises the acknowledgement, which is a separate signed step. An order nobody
                acknowledged is an order nobody is carrying out.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={record.isPending}>
            {record.isPending ? "Recording…" : "Record outcome"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AcknowledgeNewOrdersDialog({
  appointment, onOpenChange, residentId,
}: {
  appointment: AppointmentLike | null;
  onOpenChange: (open: boolean) => void;
  residentId: string;
}) {
  const { toast } = useToast();
  const acknowledge = useAcknowledgeAppointmentNewOrder(residentId);
  const [note, setNote] = useState("");

  useEffect(() => { if (appointment) setNote(""); }, [appointment]);

  const submit = async () => {
    if (!appointment) return;
    try {
      await acknowledge.mutateAsync({ appointmentId: appointment.id, note: note.trim() });
      toast({ title: "New orders acknowledged" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Could not acknowledge the orders", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={Boolean(appointment)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Acknowledge new orders</DialogTitle>
          <DialogDescription>
            Say which orders changed and what was done to carry them out. Your name and the time are
            recorded with it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ack-note">What changed, and what you did</Label>
          <Textarea
            id="ack-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Furosemide increased to 40mg daily. MAR updated and the day nurse briefed."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!note.trim() || acknowledge.isPending}>
            {acknowledge.isPending ? "Recording…" : "Acknowledge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CloseAppointmentFollowUpDialog({
  appointment, onOpenChange, residentId, outstanding,
}: {
  appointment: AppointmentLike | null;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  outstanding: { key: string; label: string; why: string }[];
}) {
  const { toast } = useToast();
  const close = useCompleteAppointmentFollowUp(residentId);
  const [note, setNote] = useState("");

  useEffect(() => { if (appointment) setNote(""); }, [appointment]);

  const submit = async () => {
    if (!appointment) return;
    try {
      await close.mutateAsync({ appointmentId: appointment.id, note: note.trim() || undefined });
      toast({ title: "Appointment follow-up closed" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Could not close the follow-up", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={Boolean(appointment)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close appointment follow-up</DialogTitle>
          <DialogDescription>
            This also closes the work item the outcome raised, so it stops appearing in the queue.
          </DialogDescription>
        </DialogHeader>
        {outstanding.length > 0 ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">Still outstanding</p>
            <ul className="mt-1 space-y-1">
              {outstanding.map((step) => (
                <li key={step.key}>
                  <span className="font-medium">{step.label}</span>
                  <span className="block text-xs text-muted-foreground">{step.why}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="close-note">Closing note</Label>
            <Textarea id="close-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional." />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={outstanding.length > 0 || close.isPending}>
            {close.isPending ? "Closing…" : "Close follow-up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RescheduleAppointmentDialog({
  appointment, onOpenChange, residentId,
}: {
  appointment: AppointmentLike | null;
  onOpenChange: (open: boolean) => void;
  residentId: string;
}) {
  const { toast } = useToast();
  const reschedule = useRescheduleAppointment(residentId);
  const [startsAt, setStartsAt] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => { if (appointment) { setStartsAt(""); setReason(""); } }, [appointment]);

  const submit = async () => {
    if (!appointment) return;
    try {
      await reschedule.mutateAsync({
        appointmentId: appointment.id,
        startsAt: new Date(startsAt).toISOString(),
        reason: reason.trim(),
      });
      toast({ title: "Appointment rescheduled", description: "The replacement inherits the transport and preparation list." });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Could not reschedule", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={Boolean(appointment)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule appointment</DialogTitle>
          <DialogDescription>
            A replacement is created and linked to this one, so the appointment does not simply
            disappear from the list. It inherits the transport arrangements and the preparation
            items.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-starts">New start</Label>
            <Input id="reschedule-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-reason">Why it moved</Label>
            <Textarea id="reschedule-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Provider cancelled; earliest available slot." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!startsAt || !reason.trim() || reschedule.isPending}>
            {reschedule.isPending ? "Rescheduling…" : "Reschedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
