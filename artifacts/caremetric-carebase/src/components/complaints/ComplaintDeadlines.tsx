import { complaintDeadlines, type ComplaintDeadlineInput } from "@/lib/complaintDeadlines";
import { formatDateForDisplay } from "@/lib/dateUtils";

export function ComplaintDeadlines({ complaint, facilityType, compact = false }: {
  complaint: ComplaintDeadlineInput;
  facilityType?: string;
  compact?: boolean;
}) {
  if (facilityType !== "PCH" && facilityType !== "ALR") return null;
  const due = complaintDeadlines(complaint);
  if (!due) return compact ? null : <p className="text-xs text-muted-foreground">The 2-business-day status report and 7-calendar-day decision clocks start with a written complaint. This intake is not recorded as an email, letter or portal submission.</p>;
  return <div className="space-y-1 text-xs">
    <p className={due.statusOverdue || due.statusLate ? "text-destructive" : "text-muted-foreground"}>Status report: {formatDateForDisplay(due.statusDue)}{due.statusOverdue ? " · overdue" : due.statusLate ? " · completed late" : complaint.acknowledgement_date ? " · recorded" : " · pending"}</p>
    <p className={due.decisionOverdue || due.decisionLate ? "text-destructive" : "text-muted-foreground"}>Written decision: {formatDateForDisplay(due.decisionDue)}{due.decisionOverdue ? " · overdue" : due.decisionLate ? " · completed late" : complaint.written_response_date ? " · recorded" : " · pending"}</p>
    {!compact && <p className="text-muted-foreground">55 Pa. Code {facilityType === "ALR" ? "2800" : "2600"}.44(e)–(f). Status reminders skip weekends; holidays do not extend this conservative reminder. Record the status report in the acknowledgement field.</p>}
  </div>;
}
