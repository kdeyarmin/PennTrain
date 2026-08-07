import { useMemo, useState } from "react";
import { ArrowRight, GitCompareArrows } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  diffSupportPlanVersions, summarizePlanDiff, supportPlanStateLabel,
  type PlanChangeKind, type PlanLike,
} from "@/lib/supportPlanLifecycle";
import { humanize } from "@/lib/utils";

const KIND_STYLE: Record<PlanChangeKind, { label: string; className: string }> = {
  added: { label: "Added", className: "border-emerald-500 text-emerald-700 dark:text-emerald-500" },
  removed: { label: "Removed", className: "border-destructive text-destructive" },
  modified: { label: "Changed", className: "border-amber-500 text-amber-700 dark:text-amber-500" },
  unchanged: { label: "Unchanged", className: "text-muted-foreground" },
};

interface ComparablePlan extends PlanLike {
  id: string;
  state: string;
  effective_date?: string | null;
}

/**
 * Side-by-side comparison of two plan versions. The diff is computed from stored content rather than
 * read from a stored diff, so correcting a version's content corrects its comparison too. Unchanged
 * entries are shown behind a toggle rather than dropped: "what stayed the same" is part of what a
 * reviewer is confirming.
 */
export function SupportPlanVersionComparison({ plans }: { plans: ComparablePlan[] }) {
  const ordered = useMemo(
    () => [...plans].sort((a, b) => b.version_number - a.version_number),
    [plans],
  );
  // Derived with a fallback rather than seeded once. `plans` is `query.data ?? []`, so the lazy
  // initializers ran against an EMPTY array on first mount and stored "" -- and when the versions
  // arrived the component rendered its comparison UI with both selects blank and no diff, on a
  // card whose entire purpose is to open on latest-vs-previous. Falling back also self-heals if the
  // selected version stops existing.
  const [selectedToId, setToId] = useState<string>("");
  const [selectedFromId, setFromId] = useState<string>("");
  const toId = ordered.some((plan) => plan.id === selectedToId) ? selectedToId : (ordered[0]?.id ?? "");
  const fromId = ordered.some((plan) => plan.id === selectedFromId) ? selectedFromId : (ordered[1]?.id ?? "");
  const [showUnchanged, setShowUnchanged] = useState(false);

  if (ordered.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCompareArrows className="h-4 w-4" /> Compare versions
          </CardTitle>
          <CardDescription>
            {ordered.length === 0
              ? "No support-plan versions to compare yet."
              : "Only one version exists. A comparison appears once this plan is revised."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const to = ordered.find((plan) => plan.id === toId) ?? ordered[0];
  const from = ordered.find((plan) => plan.id === fromId) ?? ordered[1];
  const diff = diffSupportPlanVersions(from, to);

  const label = (plan: ComparablePlan) =>
    `v${plan.version_number} · ${supportPlanStateLabel(plan.state)}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitCompareArrows className="h-4 w-4" /> Compare versions
            </CardTitle>
            <CardDescription>Exactly what changed between two versions of this support plan.</CardDescription>
          </div>
          <Badge variant="outline">{summarizePlanDiff(diff)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={from.id} onValueChange={setFromId}>
            <SelectTrigger className="h-9 w-56" aria-label="Compare from version"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ordered.map((plan) => (
                <SelectItem key={plan.id} value={plan.id} disabled={plan.id === to.id}>{label(plan)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select value={to.id} onValueChange={setToId}>
            <SelectTrigger className="h-9 w-56" aria-label="Compare to version"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ordered.map((plan) => (
                <SelectItem key={plan.id} value={plan.id} disabled={plan.id === from.id}>{label(plan)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setShowUnchanged((value) => !value)}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            {showUnchanged ? "Hide unchanged" : "Show unchanged"}
          </button>
        </div>

        {diff.totalChanges === 0 && !showUnchanged ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No differences between v{from.version_number} and v{to.version_number}.
          </p>
        ) : (
          <div className="space-y-4">
            {diff.sections.map((section) => {
              const visible = section.entries.filter((entry) => showUnchanged || entry.kind !== "unchanged");
              if (!visible.length) return null;
              return (
                <div key={section.section} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium">{section.label}</h4>
                    {section.added > 0 && <Badge variant="outline" className={KIND_STYLE.added.className}>+{section.added}</Badge>}
                    {section.removed > 0 && <Badge variant="outline" className={KIND_STYLE.removed.className}>−{section.removed}</Badge>}
                    {section.modified > 0 && <Badge variant="outline" className={KIND_STYLE.modified.className}>{section.modified} changed</Badge>}
                  </div>
                  <div className="space-y-1.5">
                    {visible.map((entry) => (
                      <div key={entry.key} className="rounded-md border p-2 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{entry.label}</span>
                          <Badge variant="outline" className={`text-[10px] ${KIND_STYLE[entry.kind].className}`}>
                            {KIND_STYLE[entry.kind].label}
                          </Badge>
                        </div>
                        {entry.fieldChanges.length > 0 && (
                          <dl className="mt-1.5 space-y-0.5 text-xs">
                            {entry.fieldChanges.map((change) => (
                              <div key={change.field} className="flex flex-wrap items-baseline gap-1.5">
                                <dt className="text-muted-foreground">{humanize(change.field)}:</dt>
                                <dd className="line-through opacity-70">{change.from ?? "—"}</dd>
                                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <dd className="font-medium">{change.to ?? "—"}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
