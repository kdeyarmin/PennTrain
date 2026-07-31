import { CheckCircle2, Circle, CircleDot, ChevronRight, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export type JobChecklistStepStatus = "complete" | "current" | "upcoming" | "blocked";

export interface JobChecklistStep {
  id: string;
  label: string;
  detail?: string;
  status: JobChecklistStepStatus;
  href?: string;
  cta?: string;
  onAction?: () => void;
}

/**
 * Shared multi-step job checklist used for onboarding, survey prep, and other
 * multi-page workflows that should feel like one job instead of N destinations.
 */
export function JobChecklist({
  title,
  description,
  steps,
  icon: Icon,
  className,
}: {
  title: string;
  description?: string;
  steps: JobChecklistStep[];
  icon?: LucideIcon;
  className?: string;
}) {
  const applicable = steps.filter((s) => s.status !== "blocked");
  const completed = applicable.filter((s) => s.status === "complete").length;
  const total = applicable.length || 1;
  const pct = Math.round((completed / total) * 100);
  const next = steps.find((s) => s.status === "current") ?? steps.find((s) => s.status === "upcoming");

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {Icon ? <Icon className="h-5 w-5 text-primary" /> : null}
              {title}
            </CardTitle>
            {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
          </div>
          <Badge variant="outline" className="shrink-0">
            {completed}/{total} complete
          </Badge>
        </div>
        <div className="pt-2 space-y-1.5">
          <Progress value={pct} className="h-2" />
          <p className="text-xs text-muted-foreground">{pct}% of this job is done</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <ol className="space-y-2">
          {steps.map((step, index) => {
            const StatusIcon =
              step.status === "complete" ? CheckCircle2
              : step.status === "current" ? CircleDot
              : Circle;
            const iconClass =
              step.status === "complete" ? "text-success"
              : step.status === "current" ? "text-primary"
              : "text-muted-foreground/50";
            return (
              <li
                key={step.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
                  step.status === "current" && "border-primary/40 bg-primary/5",
                  step.status === "complete" && "bg-muted/30",
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold text-muted-foreground border">
                  {index + 1}
                </span>
                <StatusIcon className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={cn("font-medium", step.status === "complete" && "text-muted-foreground")}>{step.label}</p>
                  {step.detail ? <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p> : null}
                </div>
                {(step.href || step.onAction) && step.status !== "complete" && (
                  step.href ? (
                    <Button asChild size="sm" variant={step.status === "current" ? "default" : "outline"} className="shrink-0 h-8">
                      <Link href={step.href}>
                        {step.cta ?? "Open"}
                        <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant={step.status === "current" ? "default" : "outline"} className="shrink-0 h-8" onClick={step.onAction}>
                      {step.cta ?? "Do this"}
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ol>
        {next && (next.href || next.onAction) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2.5">
            <p className="text-sm">
              <span className="font-medium">Next: </span>
              {next.label}
            </p>
            {next.href ? (
              <Button asChild size="sm">
                <Link href={next.href}>{next.cta ?? "Continue"}</Link>
              </Button>
            ) : next.onAction ? (
              <Button size="sm" onClick={next.onAction}>{next.cta ?? "Continue"}</Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
