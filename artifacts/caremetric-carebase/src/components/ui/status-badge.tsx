import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
  /** @deprecated Coloring is now derived from `status` itself (see STATUS_BUCKETS below), so a
   *  missing or mismatched `type` can no longer silently produce an uncolored badge. Still
   *  accepted so existing call sites don't need to change. */
  type?: 'training' | 'subscription' | 'employee' | 'alert';
}

type Bucket = 'success' | 'info' | 'warning' | 'danger' | 'missing' | 'neutral';

const BUCKET_CLASSES: Record<Bucket, string> = {
  success: "bg-success text-success-foreground hover:bg-success/80",
  info: "bg-info text-info-foreground hover:bg-info/80",
  warning: "bg-warning text-warning-foreground hover:bg-warning/80",
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive/80",
  missing: "bg-muted text-muted-foreground border border-destructive hover:bg-muted/80",
  neutral: "bg-muted text-muted-foreground hover:bg-muted/80",
};

// Exact statuses seen across the app's status-bearing columns (training/employee/alert/ticket/
// notification/course/schedule/credential/incident/violation/inspection records, subscriptions).
// Checked first so a known status always gets its intended bucket regardless of which page/table
// it came from -- no per-caller `type` flag required.
const EXACT_STATUS_BUCKET: Record<string, Bucket> = {
  compliant: 'success', active: 'success', resolved: 'success', completed: 'success',
  complete: 'success', passed: 'success', current: 'success', published: 'success',
  confirmed: 'success', delivered: 'success', sent: 'success', approved: 'success',
  cleared: 'success', verified: 'success', met: 'success', paid: 'success', good: 'success',
  attended: 'success', present: 'success',

  trial: 'info', pending_review: 'info', scheduled: 'info', upcoming: 'info',
  assigned: 'info', draft: 'info', in_progress: 'info', review: 'info', invited: 'info',
  new: 'info', queued: 'info', processing: 'info',

  due_soon: 'warning', on_leave: 'warning', expiring: 'warning', past_due: 'warning',
  pending: 'warning', waiting: 'warning', partial: 'warning', not_started: 'warning',

  expired: 'danger', overdue: 'danger', terminated: 'danger', critical: 'danger',
  open: 'danger', failed: 'danger', rejected: 'danger', denied: 'danger',
  canceled: 'danger', cancelled: 'danger', suspended: 'danger', no_show: 'danger',
  called_off: 'danger', escalated: 'danger', unmet: 'danger', excused: 'danger', declined: 'danger',

  missing: 'missing',

  not_applicable: 'neutral', na: 'neutral', inactive: 'neutral', dismissed: 'neutral',
  closed: 'neutral', archived: 'neutral', none: 'neutral',
};

// Fallback for statuses not in the exact map above -- e.g. a new enum value added to a table
// this component hasn't been updated for yet. Order matters: more specific/dangerous patterns
// are checked first so e.g. "past_due" (danger) isn't caught by a looser "due" pattern first.
const FALLBACK_PATTERNS: [RegExp, Bucket][] = [
  [/expired|overdue|terminat|cancel|reject|denied|fail|critical|suspend|escalat|no_show|call.*off/, 'danger'],
  [/pending|progress|wait|due_soon|partial|not_started/, 'warning'],
  [/trial|review|draft|schedul|assign|upcoming|queue|process/, 'info'],
  [/complian|active|resolv|complet|pass|current|publish|confirm|deliver|sent|approv|clear|verif|met\b/, 'success'],
  [/inactive|dismiss|closed|archiv|not_applicable|^na$/, 'neutral'],
];

function bucketFor(status: string): Bucket {
  const s = status.toLowerCase();
  if (s in EXACT_STATUS_BUCKET) return EXACT_STATUS_BUCKET[s];
  const match = FALLBACK_PATTERNS.find(([pattern]) => pattern.test(s));
  return match ? match[1] : 'neutral';
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const label = status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  const badgeClasses = status ? BUCKET_CLASSES[bucketFor(status)] : BUCKET_CLASSES.neutral;

  return (
    <Badge className={cn("whitespace-nowrap font-medium px-2.5 py-0.5", badgeClasses, className)} variant="outline">
      {label}
    </Badge>
  );
}
