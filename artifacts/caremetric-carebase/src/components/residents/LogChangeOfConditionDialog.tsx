import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useListProfiles } from "@/hooks/useProfiles";
import { useCreateResidentChangeEvent } from "@/hooks/useResidentChangeEvents";

export interface ChangeOfConditionResidentOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface LogChangeOfConditionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Exactly one of the two: a fixed resident (ResidentDetail) or a picker list (State Forms
  // Center, where the user hasn't navigated to a specific resident yet).
  residentId?: string;
  residents?: ChangeOfConditionResidentOption[];
  sourceServiceAlertId?: string;
}

export function LogChangeOfConditionDialog({ open, onOpenChange, residentId, residents, sourceServiceAlertId }: LogChangeOfConditionDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const createEvent = useCreateResidentChangeEvent();
  const { data: profiles } = useListProfiles({ organizationId: user?.organizationId ?? undefined });
  const [selectedResidentId, setSelectedResidentId] = useState("");
  const [category, setCategory] = useState("other_significant_change");
  const [identifiedAt, setIdentifiedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [observations, setObservations] = useState("");
  const [immediateAction, setImmediateAction] = useState("");
  const [providerStatus, setProviderStatus] = useState("pending");
  const [designatedStatus, setDesignatedStatus] = useState("pending");
  const [emergencyTransfer, setEmergencyTransfer] = useState(false);
  const [destination, setDestination] = useState("");
  const [monitoringInstructions, setMonitoringInstructions] = useState("");
  const [monitoringFrequency, setMonitoringFrequency] = useState("");
  const [monitoringHours, setMonitoringHours] = useState("24");
  const [assignedProfileId, setAssignedProfileId] = useState(user?.id ?? "");
  const [followUpDueAt, setFollowUpDueAt] = useState(() => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 16));
  const [incidentDecision, setIncidentDecision] = useState("pending");
  const [reassessmentRequired, setReassessmentRequired] = useState(true);
  const [supportPlanRevisionRequired, setSupportPlanRevisionRequired] = useState(true);

  const targetResidentId = residentId ?? selectedResidentId;

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setSelectedResidentId("");
      setCategory("other_significant_change");
      setObservations("");
      setImmediateAction("");
      setProviderStatus("pending");
      setDesignatedStatus("pending");
      setEmergencyTransfer(false);
      setDestination("");
      setMonitoringInstructions("");
      setMonitoringFrequency("");
      setIncidentDecision("pending");
    }
  };

  const handleSubmit = () => {
    if (!targetResidentId) return;
    createEvent.mutate(
      {
        residentId: targetResidentId,
        category,
        identifiedAt: new Date(identifiedAt).toISOString(),
        immediateObservations: observations.trim(),
        immediateActionTaken: immediateAction.trim(),
        providerNotificationStatus: providerStatus,
        designatedPersonNotificationStatus: designatedStatus,
        emergencyTransfer,
        emergencyTransferDestination: destination.trim() || null,
        monitoringInstructions: monitoringInstructions.trim() || null,
        monitoringFrequency: monitoringFrequency.trim() || null,
        monitoringDurationHours: monitoringInstructions.trim() ? Number(monitoringHours) : null,
        assignedProfileId: assignedProfileId || user?.id || null,
        followUpDueAt: new Date(followUpDueAt).toISOString(),
        incidentDecision,
        reassessmentRequired,
        supportPlanRevisionRequired,
        sourceServiceAlertId,
      },
      {
        onSuccess: (eventId) => {
          toast({
            title: "Change-of-condition workflow started",
            description: reassessmentRequired
              ? "A significant-change reassessment and owned follow-up were created."
              : "Owned monitoring and follow-up were created.",
            action: (
              <Button asChild size="sm" variant="outline">
                <a href={`/app/change-of-condition/${eventId}`}>Open event</a>
              </Button>
            ),
          });
          close(false);
        },
        onError: (e: Error) => toast({ title: "Failed to start change workflow", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Structured Change of Condition</DialogTitle>
          <DialogDescription>
            Record observations and required follow-up without making a diagnosis or replacing clinical judgment.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          {!residentId && (
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Resident</Label>
              <Select value={selectedResidentId} onValueChange={setSelectedResidentId}>
                <SelectTrigger><SelectValue placeholder="Select a resident" /></SelectTrigger>
                <SelectContent>
                  {(residents ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.last_name}, {r.first_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label>Type of change *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[
                  "fall", "emergency_department_visit", "hospital_return", "mobility_decline",
                  "skin_concern", "appetite_intake_change", "weight_concern",
                  "mental_status_change", "behavioral_change", "infection_symptoms",
                  "continence_change", "new_supervision_concern",
                  "hospice_end_of_life_change", "other_significant_change",
                ].map(value => <SelectItem key={value} value={value}>{value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase())}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Identified date and time *</Label><Input type="datetime-local" value={identifiedAt} onChange={event => setIdentifiedAt(event.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Immediate observations *</Label><Textarea value={observations} onChange={event => setObservations(event.target.value)} placeholder="Describe observable facts; do not diagnose." /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Immediate action taken *</Label><Textarea value={immediateAction} onChange={event => setImmediateAction(event.target.value)} placeholder="Safety action, escalation, or other response." /></div>
          <div className="space-y-1"><Label>Provider notification</Label><Select value={providerStatus} onValueChange={setProviderStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["pending", "completed", "unable_to_reach", "not_required"].map(value => <SelectItem key={value} value={value}>{value.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Designated-person notification</Label><Select value={designatedStatus} onValueChange={setDesignatedStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["pending", "completed", "unable_to_reach", "not_required"].map(value => <SelectItem key={value} value={value}>{value.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={emergencyTransfer} onCheckedChange={value => setEmergencyTransfer(value === true)} />Emergency transfer occurred</label>
          {emergencyTransfer && <div className="space-y-1 sm:col-span-2"><Label>Transfer destination *</Label><Input value={destination} onChange={event => setDestination(event.target.value)} /></div>}
          <div className="space-y-1 sm:col-span-2"><Label>Monitoring instructions</Label><Textarea value={monitoringInstructions} onChange={event => setMonitoringInstructions(event.target.value)} placeholder="What staff should observe and report." /></div>
          <div className="space-y-1"><Label>Monitoring frequency</Label><Input value={monitoringFrequency} onChange={event => setMonitoringFrequency(event.target.value)} placeholder="e.g. Every 2 hours" /></div>
          <div className="space-y-1"><Label>Duration (hours)</Label><Input type="number" min={1} max={720} value={monitoringHours} onChange={event => setMonitoringHours(event.target.value)} /></div>
          <div className="space-y-1"><Label>Assigned staff</Label><Select value={assignedProfileId} onValueChange={setAssignedProfileId}><SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger><SelectContent>{profiles?.filter(profile => profile.is_active).map(profile => <SelectItem key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Follow-up due *</Label><Input type="datetime-local" value={followUpDueAt} onChange={event => setFollowUpDueAt(event.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Incident report decision *</Label><Select value={incidentDecision} onValueChange={setIncidentDecision}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pending human decision</SelectItem><SelectItem value="required">Incident report required</SelectItem><SelectItem value="not_required">Incident report not required</SelectItem></SelectContent></Select></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={reassessmentRequired} onCheckedChange={value => setReassessmentRequired(value === true)} />Significant-change reassessment required</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={supportPlanRevisionRequired} onCheckedChange={value => setSupportPlanRevisionRequired(value === true)} />Support-plan revision review required</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !targetResidentId || !observations.trim() || !immediateAction.trim()
              || !identifiedAt || !followUpDueAt || (emergencyTransfer && !destination.trim())
              || createEvent.isPending
            }
          >
            {createEvent.isPending ? "Starting..." : "Start Guided Workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
