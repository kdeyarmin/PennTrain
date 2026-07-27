import { useMemo, useState } from "react";
import { Link } from "wouter";
import { BarChart3, ExternalLink, Lightbulb, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useIncidentTrendRecords } from "@/hooks/useIncidentTrends";
import { useCreateQapiProject, useListQapiProjects } from "@/hooks/useQapi";
import { useListProfiles } from "@/hooks/useProfiles";
import { buildIncidentTrends, type TrendBucket } from "@/lib/incidentTrends";
import {
  buildQapiRecommendations, type ExistingQapiProjectLike, type QapiRecommendation,
} from "@/lib/qapiRecommendations";
import { toLocalIsoDate } from "@/lib/dateUtils";

const WINDOW_OPTIONS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 180 days" },
  { value: "365", label: "Last 12 months" },
];

/**
 * A bar rendered from the bucket's own share of the largest bucket. No library: one div and a width,
 * which stays readable in the print view the meeting packet uses.
 */
function BucketRow({ bucket, max, onDrill }: { bucket: TrendBucket; max: number; onDrill: () => void }) {
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <button type="button" className="text-left hover:underline" onClick={onDrill}>
          {bucket.label}
        </button>
        <span className="shrink-0 tabular-nums text-muted-foreground">{bucket.count}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className="h-1.5 rounded-full bg-primary"
          style={{ width: `${max === 0 ? 0 : Math.round((bucket.count / max) * 100)}%` }}
        />
      </div>
    </li>
  );
}

function DrillDialog({
  bucket, onOpenChange,
}: {
  bucket: { label: string; incidentIds: string[] } | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={bucket !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bucket?.label}</DialogTitle>
          <DialogDescription>
            The records behind this number. A figure nobody can open is a figure nobody can defend.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm">
          {(bucket?.incidentIds ?? []).map((id) => (
            <li key={id}>
              <Link href={`/app/incidents/${id}`} className="flex items-center gap-1.5 text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> Open incident
              </Link>
            </li>
          ))}
          {bucket?.incidentIds.length === 0 && (
            <li className="text-muted-foreground">
              This figure comes from corrective actions rather than incidents; open the incidents
              they belong to from the project.
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function RecommendationCard({
  recommendation, facilityId, onOpened,
}: {
  recommendation: QapiRecommendation;
  facilityId: string;
  onOpened: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const create = useCreateQapiProject();
  const { data: profiles } = useListProfiles();
  const [open, setOpen] = useState(false);
  const [lead, setLead] = useState(user?.id ?? "");
  const [completion, setCompletion] = useState(
    toLocalIsoDate(new Date(Date.now() + 90 * 864e5)),
  );
  const [problem, setProblem] = useState(recommendation.suggestedProblemStatement);

  const managers = (profiles ?? []).filter(
    (profile) => profile.is_active && ["org_admin", "facility_manager"].includes(profile.role),
  );

  const submit = async () => {
    try {
      await create.mutateAsync({
        facilityId,
        title: recommendation.title,
        problem: problem.trim(),
        source: recommendation.finding,
        baseline: recommendation.finding,
        objective: "",
        target: "",
        completion,
        lead,
        patternKey: recommendation.patternId,
      });
      toast({ title: "QAPI project opened" });
      setOpen(false);
      onOpened();
    } catch (error) {
      toast({
        title: "Could not open the project",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <div className="rounded-md border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-medium">{recommendation.title}</p>
          <Badge variant="outline" className="shrink-0">{recommendation.incidentIds.length} records</Badge>
        </div>
        <p className="mt-1 text-sm">{recommendation.finding}</p>
        <p className="mt-1 text-xs text-muted-foreground">{recommendation.rationale}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Threshold: {recommendation.threshold}
        </p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
          Open a QAPI project
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{recommendation.title}</DialogTitle>
            <DialogDescription>
              The finding and its records become the project's baseline. Opening a project for this
              pattern suppresses the recommendation until the project closes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={`problem-${recommendation.patternId}`}>Problem statement</Label>
              <Textarea
                id={`problem-${recommendation.patternId}`}
                rows={3}
                value={problem}
                onChange={(event) => setProblem(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={`lead-${recommendation.patternId}`}>Project lead</Label>
              <Select value={lead} onValueChange={setLead}>
                <SelectTrigger id={`lead-${recommendation.patternId}`}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {managers.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.first_name} {profile.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={`due-${recommendation.patternId}`}>Target completion</Label>
              <Input
                id={`due-${recommendation.patternId}`}
                type="date"
                value={completion}
                onChange={(event) => setCompletion(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!lead || problem.trim().length < 10 || create.isPending}>
              {create.isPending ? "Opening..." : "Open project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Incident trends and the QAPI recommendations derived from them (program plan Phase 6c/6d).
 *
 * Every bar opens its records, and every recommendation names the threshold it crossed. Nothing here
 * scores or ranks: the request is explicit that a black-box number is not wanted, and these are
 * counts of things that happened with the evidence one click away.
 */
export default function IncidentTrendsSection({
  facilityId, organizationId,
}: {
  facilityId: string;
  organizationId: string | undefined;
}) {
  const [windowDays, setWindowDays] = useState("90");
  const [drill, setDrill] = useState<{ label: string; incidentIds: string[] } | null>(null);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(windowDays) * 864e5);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [windowDays]);

  const records = useIncidentTrendRecords({ facilityId, from: range.from, to: range.to });
  const projects = useListQapiProjects({ organizationId, facilityId });

  const trends = useMemo(() => buildIncidentTrends({
    incidents: records.data?.incidents ?? [],
    correctiveActions: records.data?.corrective_actions ?? [],
  }), [records.data]);

  const windowLabel = WINDOW_OPTIONS.find((entry) => entry.value === windowDays)?.label.toLowerCase()
    ?? `the last ${windowDays} days`;

  const recommendations = useMemo(() => buildQapiRecommendations({
    trends,
    windowLabel,
    existingProjects: (projects.data ?? []) as unknown as ExistingQapiProjectLike[],
  }), [trends, windowLabel, projects.data]);

  const effectiveness = trends.correctiveActionEffectiveness;

  if (records.isLoading) return <Skeleton className="h-72 w-full" />;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" /> Incident trends
              </CardTitle>
              <CardDescription>
                Every figure opens the records behind it. {records.data?.incidents.length ?? 0} incidents
                in {windowLabel}.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={windowDays} onValueChange={setWindowDays}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((entry) => (
                    <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" /> Meeting packet
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Investigations past due</p>
              <button
                type="button"
                className="text-2xl font-semibold tabular-nums hover:underline"
                onClick={() => setDrill(trends.overdueInvestigations)}
              >
                {trends.overdueInvestigations.count}
              </button>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Corrective actions overdue</p>
              <p className="text-2xl font-semibold tabular-nums">{effectiveness.overdue}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Completed actions verified</p>
              <p className="text-2xl font-semibold tabular-nums">
                {effectiveness.verifiedRate === null ? "—" : `${effectiveness.verifiedRate}%`}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {effectiveness.verified} of {effectiveness.total} — an action nobody checked is a claim.
              </p>
            </div>
          </div>

          {trends.series.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No incidents recorded in this period, so there is nothing to trend.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {trends.series.map((entry) => {
                const max = Math.max(...entry.buckets.map((bucket) => bucket.count));
                return (
                  <div key={entry.key} className="space-y-2 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">{entry.title}</p>
                      <p className="text-[11px] text-muted-foreground">{entry.purpose}</p>
                    </div>
                    <ul className="space-y-2">
                      {entry.buckets.slice(0, 6).map((bucket) => (
                        <BucketRow
                          key={bucket.key}
                          bucket={bucket}
                          max={max}
                          onDrill={() => setDrill(bucket)}
                        />
                      ))}
                    </ul>
                    {entry.buckets.length > 6 && (
                      <p className="text-[11px] text-muted-foreground">
                        Showing the 6 largest of {entry.buckets.length}.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {trends.repeatResidents.length > 0 && (
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">Residents with more than one incident</p>
              <ul className="mt-2 space-y-1 text-sm">
                {trends.repeatResidents.map((bucket) => (
                  <li key={bucket.key}>
                    <button type="button" className="hover:underline" onClick={() => setDrill(bucket)}>
                      {bucket.label} — {bucket.count} incidents
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" /> Recommended QAPI projects
          </CardTitle>
          <CardDescription>
            Patterns that crossed a stated threshold in {windowLabel}. Each names the threshold and
            the records, so it can be argued with rather than taken on faith.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pattern crossed a threshold in this period. Patterns already carrying an open
              project are not repeated here.
            </p>
          ) : (
            recommendations.map((recommendation) => (
              <RecommendationCard
                key={recommendation.patternId}
                recommendation={recommendation}
                facilityId={facilityId}
                onOpened={() => projects.refetch()}
              />
            ))
          )}
        </CardContent>
      </Card>

      <DrillDialog bucket={drill} onOpenChange={(open) => !open && setDrill(null)} />
    </>
  );
}
