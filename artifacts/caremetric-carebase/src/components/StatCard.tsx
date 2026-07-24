import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

/**
 * Shared metric tile built on the app's `.stat-card` design-system class (see index.css).
 * Gives the org app, admin, and role dashboards one consistent stat treatment — a colored
 * icon chip, a large serif-adjacent value, a muted label, and an optional hint or inline
 * chart — instead of the ad-hoc `rounded-lg border p-4` tiles that made admin look plainer.
 * Renders as a link, a button, or a static card depending on the props passed.
 */

type Tone = "default" | "primary" | "success" | "warning" | "danger" | "info";

const TONE_ICON: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success-strong",
  warning: "bg-warning/10 text-warning-strong",
  danger: "bg-destructive/10 text-destructive-strong",
  info: "bg-info/10 text-info-strong",
};

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Small supporting line under the value (e.g. "3 awaiting review"). */
  hint?: ReactNode;
  icon?: LucideIcon;
  /** Override the tone-derived icon-chip colors. */
  iconClassName?: string;
  tone?: Tone;
  /** Renders the whole card as a wouter Link. */
  href?: string;
  /** Renders the whole card as a button. Ignored when `href` is set. */
  onClick?: () => void;
  /** Optional inline visual (e.g. a <Sparkline/>) shown under the value. */
  chart?: ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  iconClassName,
  tone = "default",
  href,
  onClick,
  chart,
  className,
}: StatCardProps) {
  const interactive = Boolean(href || onClick);
  const cls = cn(
    "stat-card block text-left",
    interactive && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    className,
  );

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="stat-label">{label}</p>
          <p className="stat-value mt-1.5">{value}</p>
        </div>
        {Icon ? (
          <span className={cn("stat-icon shrink-0", iconClassName ?? TONE_ICON[tone])}>
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
      {chart ? <div className="mt-3">{chart}</div> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cls, "w-full")}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}
