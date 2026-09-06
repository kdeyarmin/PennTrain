import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/utils";

/**
 * A resident's lifecycle state, rendered as itself.
 *
 * residents.status carries seven values -- reserved, active, temporarily_out, hospital_leave,
 * discharged, deceased, and whatever a future migration adds -- and surfaces that collapsed them to
 * "Active or Discharged" told a caregiver that a resident in hospital, and every pre-admission
 * resident in a move-in workspace, had been discharged. Extracted from the roster so the resident
 * record and the roster cannot disagree about what a status looks like; the fallback tone keeps an
 * unrecognised value legible rather than blank.
 */
export function ResidentStatusPill({ status }: { status: string }) {
  const className = status === "active"
    ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "reserved"
      ? "bg-purple-100 text-purple-900"
      : status === "temporarily_out" || status === "hospital_leave"
        ? "bg-amber-100 text-amber-900"
        : status === "deceased"
          ? "bg-slate-200 text-slate-900"
          : "bg-muted text-muted-foreground";
  return <Badge className={className} variant="outline">{humanize(status)}</Badge>;
}
