import { Link } from "wouter";
import { ArrowRight, Check, CircleDashed, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { QueryError } from "@/components/QueryState";
import { summarizeSetupProgress } from "@/lib/enterpriseOperations";
import { buildOrganizationSetupSteps, organizationNeedsSetup } from "@/lib/organizationSetup";
import { useOrganizationSetup } from "@/hooks/useOrganizationSetup";

/**
 * First-run guide for a newly signed-up organization.
 *
 * Signup creates an organizations row and one org_admin profile -- nothing else. Every
 * surface the new admin lands on is therefore correct and empty, with no indication that
 * "add a facility" is the one action that unblocks the rest. This puts that path on Home
 * and retires itself once the organization is actually operating.
 */
export function OrganizationSetupGuide({ organizationId }: { organizationId: string | undefined }) {
  const setup = useOrganizationSetup(organizationId);

  // Silent while loading: a card that pops in after the rest of Home has painted is worse
  // than one that appears with the page on the next visit.
  if (setup.isLoading || !setup.data) {
    if (setup.isError) {
      return (
        <QueryError
          what="your setup progress"
          error={setup.error}
          onRetry={() => void setup.refetch()}
        />
      );
    }
    return null;
  }

  if (!organizationNeedsSetup(setup.data)) return null;

  const steps = buildOrganizationSetupSteps(setup.data);
  const progress = summarizeSetupProgress(steps);
  const next = steps.find((step) => !step.complete && !step.blocked);

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle>Finish setting up your organization</CardTitle>
        <CardDescription>
          {next
            ? `${progress.complete} of ${progress.total} done — next: ${next.label.toLowerCase()}.`
            : `${progress.complete} of ${progress.total} done.`}
        </CardDescription>
        <Progress value={progress.percent} className="mt-2 h-2" aria-label="Organization setup progress" />
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((step) => (
          <div
            key={step.key}
            className="flex flex-wrap items-center gap-3 rounded-lg border bg-background/80 p-3"
          >
            <span aria-hidden="true" className="shrink-0">
              {step.complete
                ? <Check className="h-4 w-4 text-success" />
                : step.blocked
                  ? <Lock className="h-4 w-4 text-muted-foreground" />
                  : <CircleDashed className="h-4 w-4 text-primary" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${step.complete ? "text-muted-foreground line-through" : ""}`}>
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">
                {step.blocked ? step.blockedReason : step.why}
              </p>
            </div>
            {!step.complete && (
              <Button asChild size="sm" variant={step === next ? "default" : "outline"} className="shrink-0">
                <Link href={step.href}>
                  {step.cta}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            )}
            <span className="sr-only">
              {step.complete ? "Completed" : step.blocked ? "Not available yet" : "Not started"}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
