import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
  type?: 'training' | 'subscription' | 'employee' | 'alert';
}

export function StatusBadge({ status, className, type = 'training' }: StatusBadgeProps) {
  let badgeClasses = "";
  let label = status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());

  if (type === 'training' || type === 'alert' || type === 'employee') {
    switch (status.toLowerCase()) {
      case 'compliant':
      case 'active':
      case 'resolved':
        badgeClasses = "bg-success text-success-foreground hover:bg-success/80";
        break;
      case 'due_soon':
      case 'on_leave':
        badgeClasses = "bg-warning text-warning-foreground hover:bg-warning/80";
        break;
      case 'expired':
      case 'terminated':
      case 'critical':
      case 'open':
        badgeClasses = "bg-destructive text-destructive-foreground hover:bg-destructive/80";
        break;
      case 'missing':
        badgeClasses = "bg-muted text-muted-foreground border border-destructive hover:bg-muted/80";
        break;
      case 'pending_review':
        badgeClasses = "bg-info text-info-foreground hover:bg-info/80";
        break;
      case 'not_applicable':
      case 'inactive':
      case 'dismissed':
        badgeClasses = "bg-muted text-muted-foreground hover:bg-muted/80";
        break;
      default:
        badgeClasses = "bg-secondary text-secondary-foreground hover:bg-secondary/80";
    }
  } else if (type === 'subscription') {
    switch (status.toLowerCase()) {
      case 'trial':
        badgeClasses = "bg-info text-info-foreground hover:bg-info/80";
        break;
      case 'active':
        badgeClasses = "bg-success text-success-foreground hover:bg-success/80";
        break;
      case 'past_due':
        badgeClasses = "bg-warning text-warning-foreground hover:bg-warning/80";
        break;
      case 'canceled':
        badgeClasses = "bg-destructive text-destructive-foreground hover:bg-destructive/80";
        break;
      default:
        badgeClasses = "bg-secondary text-secondary-foreground hover:bg-secondary/80";
    }
  }

  return (
    <Badge className={cn("whitespace-nowrap font-medium px-2.5 py-0.5", badgeClasses, className)} variant="outline">
      {label}
    </Badge>
  );
}
