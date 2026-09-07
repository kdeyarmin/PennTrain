import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useTransitionResidentCensus } from "@/hooks/useAdmissions";
import { humanize } from "@/lib/utils";
import { ResidentStatusPill } from "@/components/residents/ResidentStatusPill";

/**
 * The five states transition_resident_census accepts as a target. `reserved` is deliberately not
 * one of them: a resident becomes reserved when start_move_in_workspace creates them, and nothing
 * puts an admitted resident back into pre-admission.
 */
export const CENSUS_TARGET_STATUSES = ["active", "temporarily_out", "hospital_leave", "discharged", "deceased"] as const;

/**
 * What this dialog offers, derived from the transition graph `transition_resident_census` enforces
 * (20260906110000).
 *
 * This replaces a single "not reserved -> active" exclusion, which was the wrong shape: it blocked
 * one edge and left the two-step route around it open, since a reserved resident sent
 * `temporarily_out` is no longer reserved and the next dialog then offers `active`. Two moves and
 * an admitted resident sits on a bed still held for a prospect, having run none of
 * complete_move_in_admission's checks. The RPC is the control -- this is the courtesy on top of it,
 * and every entry here must be one the RPC accepts, or the dialog offers a 22023.
 *
 * It is a SUBSET of that graph, deliberately, and the direction matters: the server also accepts
 * three same-status edges, and all three are bed operations. `active -> active` is a room transfer
 * and `discharged -> discharged` / `deceased -> deceased` is the bed-release repair
 * AdmissionOperations.tsx offers. This dialog never sends a bed id, and the RPC refuses same status
 * with an unchanged bed ("Census transition would not change resident state"), so offering any of
 * them HERE could only ever produce that refusal. They belong on the surface that owns beds, which
 * is Admission Operations. A subset is safe; a superset is what returns 22023.
 */
export const CENSUS_TRANSITIONS: Record<string, readonly string[]> = {
  // Pre-admission: cancelling is legitimate, everything else belongs to the admission workflow.
  prospect: ["discharged", "deceased"],
  applicant: ["discharged", "deceased"],
  approved: ["discharged", "deceased"],
  waitlisted: ["discharged", "deceased"],
  reserved: ["discharged", "deceased"],
  active: ["temporarily_out", "hospital_leave", "discharged", "deceased"],
  temporarily_out: ["active", "hospital_leave", "discharged", "deceased"],
  hospital_leave: ["active", "temporarily_out", "discharged", "deceased"],
  // Terminal for a STATUS change. The server also takes discharged -> discharged and
  // deceased -> deceased, but only to release a bed the old bare-discharge path left occupied, and
  // that repair lives on Admission Operations where a bed is in hand. A readmission is a new
  // admission, not an edit to a closed record.
  discharged: [],
  deceased: [],
};

/** The census RPC refuses a reason shorter than this after trimming. */
export const CENSUS_REASON_MIN_LENGTH = 3;

/**
 * Changing a resident's census state from their own record.
 *
 * This used to be a bare `update residents set status = ...` behind a two-option Select, which is
 * how a discharged resident kept their bed: the row said discharged, facility_beds still said
 * occupied, and set_bed_availability then refused to release it ("Occupied or reserved beds must be
 * released through census workflow") because releasing an occupied bed is the census workflow's job.
 * transition_resident_census is that workflow -- it releases the bed, nulls residents.bed_id, stamps
 * the discharge date on the facility's calendar day, and writes the resident_census_events row that
 * a DHS inspector reads back -- and it requires a reason, which is why this is a dialog and not a
 * dropdown.
 */
export function ResidentCensusStatusDialog({
  open, onOpenChange, residentId, residentName, currentStatus, moveInHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  residentId: string;
  residentName: string;
  currentStatus: string;
  /** Where admitting a reserved resident actually happens, when the caller knows. */
  moveInHref?: string;
}) {
  const { toast } = useToast();
  const transitionCensus = useTransitionResidentCensus();
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setTarget("");
    setReason("");
  }, [open]);

  const isReserved = currentStatus === "reserved";
  // An unknown current status offers nothing rather than everything: a state this file has not
  // been taught about is not a licence to guess, and the RPC would refuse the guess anyway.
  const allowed = CENSUS_TRANSITIONS[currentStatus ?? ""] ?? [];
  const options = CENSUS_TARGET_STATUSES.filter((value) => {
    // The RPC refuses a transition that would not change anything, so offering the current state
    // could only produce a raw "Census transition would not change resident state" error.
    if (value === currentStatus) return false;
    return allowed.includes(value);
  });

  const submit = () => {
    if (!target || reason.trim().length < CENSUS_REASON_MIN_LENGTH) return;
    transitionCensus.mutate(
      { residentId, targetStatus: target, reason: reason.trim() },
      {
        onSuccess: () => {
          toast({ title: "Census updated", description: `${residentName} is now ${humanize(target).toLowerCase()}.` });
          onOpenChange(false);
        },
        // A refused transition (RLS, a bed that moved underneath, a state the RPC will not accept)
        // has to say so. The control this replaced had no error path at all: the Select showed the
        // new value until the next refetch quietly snapped it back, and silence reads as success on
        // a status change.
        onError: (error: Error) => toast({
          title: "Could not change this resident's status",
          description: error.message,
          variant: "destructive",
        }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change resident status</DialogTitle>
          <DialogDescription>
            Recorded as a census event on {residentName}'s record. Discharge and death release the
            resident's bed; leave and return keep it held for them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Currently</span>
            <ResidentStatusPill status={currentStatus} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="census-target">New status</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="census-target" aria-label="New resident status">
                <SelectValue placeholder="Select a status" />
              </SelectTrigger>
              <SelectContent>
                {options.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}
              </SelectContent>
            </Select>
            {isReserved && (
              <p className="text-xs text-muted-foreground">
                This resident has not moved in yet. Admitting them happens in their move-in
                workspace, which re-checks readiness before the bed changes hands
                {moveInHref ? <> — see <Link href={moveInHref} className="text-primary hover:underline">Admissions</Link>.</> : "."}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="census-reason">Reason</Label>
            <Textarea
              id="census-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why the resident's status is changing"
            />
            <p className="text-xs text-muted-foreground">
              Required — it is stored on the census event and read back on inspection.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={!target || reason.trim().length < CENSUS_REASON_MIN_LENGTH || transitionCensus.isPending}
          >
            {transitionCensus.isPending ? "Recording..." : "Record status change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ResidentCensusStatusDialog;
