/**
 * Adaptive learning paths, end to end (BACKLOG.md G11).
 *
 * The Adaptive tab showed three counters — published paths, active assignments, remediation
 * transitions — over tables nothing in the product could write. `evaluate_learning_path` was the one
 * granted function in the area and it had no caller, because there were no assignments for it to
 * evaluate. Migration `20260804140000` supplies authoring, publication and assignment; this panel
 * drives all four steps.
 */
import { useState } from "react";
import { GitBranch, Loader2, Play, Send } from "lucide-react";
import {
  useAssignLearningPath,
  useEvaluateLearningPath,
  useLearningPathAssignments,
  useLearningPathVersions,
  usePublishLearningPathVersion,
  useSaveLearningPathVersion,
} from "@/hooks/useLearningPaths";
import { useListEmployees } from "@/hooks/useEmployees";
import { facilityDayBounds } from "@/lib/dateUtils";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  formatPathSteps,
  parsePathSteps,
  pathDefinitionIssues,
  stepReasonLabel,
  stepStateLabel,
} from "@/lib/learningPaths";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const EXAMPLE_STEPS = "foundation\nassessment after foundation @80\nremediation after assessment";

function AuthorPathCard() {
  const save = useSaveLearningPathVersion();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stepText, setStepText] = useState(EXAMPLE_STEPS);

  const steps = parsePathSteps(stepText);
  const issues = pathDefinitionIssues(steps);
  const nameIssue = name.trim().length < 3 ? "Give the path a name of at least three characters." : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Author a path</CardTitle>
        <CardDescription>
          One step per line. <code>after</code> names prerequisites, <code>@80</code> sets the score below
          which the evaluator selects the remedial branch. A new path starts as a draft.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="path-name">Name</Label>
          <Input id="path-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Medication administration path" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="path-description">Description</Label>
          <Input id="path-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="path-steps">Steps</Label>
          <Textarea id="path-steps" rows={5} className="font-mono text-sm" value={stepText} onChange={(e) => setStepText(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="md:col-span-2 space-y-2">
          {nameIssue && <p className="text-xs text-muted-foreground">{nameIssue}</p>}
          {issues.map((issue) => <p key={issue} className="text-xs text-muted-foreground">{issue}</p>)}
          <Button
            disabled={!!nameIssue || issues.length > 0 || save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync({
                  name: name.trim(),
                  description: description.trim() || undefined,
                  definition: { steps },
                });
                toast({ title: "Draft path version saved" });
                setName("");
                setDescription("");
                setStepText(EXAMPLE_STEPS);
              } catch (error) {
                toast({ title: "Could not save the path", description: errorMessage(error), variant: "destructive" });
              }
            }}
          >
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitBranch className="mr-2 h-4 w-4" />}
            Save draft
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AssignmentRow({
  assignment,
  stepKeys,
}: {
  assignment: {
    id: string;
    state: string;
    state_version: number;
    due_at: string | null;
    current_state: unknown;
    employee: { first_name: string; last_name: string } | null;
  };
  stepKeys: string[];
}) {
  const evaluate = useEvaluateLearningPath();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [scores, setScores] = useState<Record<string, string>>({});

  const currentState = (assignment.current_state ?? {}) as Record<
    string,
    { state?: string; reason?: string; explanation?: string }
  >;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {assignment.employee ? `${assignment.employee.last_name}, ${assignment.employee.first_name}` : "Unknown employee"}
          </p>
          <p className="text-xs text-muted-foreground">
            {assignment.state} · state v{assignment.state_version}
            {assignment.due_at ? ` · due ${new Date(assignment.due_at).toLocaleDateString()}` : ""}
          </p>
          {Object.entries(currentState).map(([key, value]) => (
            <p key={key} className="text-xs text-muted-foreground">
              {key}: {stepStateLabel(value.state ?? "")} — {stepReasonLabel(value.reason ?? "")}
            </p>
          ))}
        </div>
        {/* `evaluate_learning_path` recomputes current_state from the submitted outcomes alone and
            does not refuse a finished assignment. Evaluating a completed one with a partial or
            empty outcome would bump state_version and rewrite its steps back to available/locked
            while the row still reads `completed`, so the action stops at the end of the path. */}
        <Button
          size="sm"
          variant="outline"
          disabled={assignment.state !== "active"}
          title={assignment.state !== "active" ? `This assignment is ${assignment.state}.` : undefined}
          onClick={() => setOpen(!open)}
        >
          <Play className="mr-1 h-4 w-4" />{open ? "Cancel" : "Evaluate"}
        </Button>
      </div>

      {open && (
        <div className="space-y-2">
          {stepKeys.map((key) => (
            <div key={key} className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={completed[key] ?? false}
                  onChange={(event) => setCompleted((prev) => ({ ...prev, [key]: event.target.checked }))}
                />
                {key} complete
              </label>
              <Input
                className="w-28"
                type="number"
                min={0}
                max={100}
                placeholder="score"
                value={scores[key] ?? ""}
                onChange={(event) => setScores((prev) => ({ ...prev, [key]: event.target.value }))}
                aria-label={`${key} score`}
              />
            </div>
          ))}
          <Button
            size="sm"
            disabled={evaluate.isPending}
            onClick={async () => {
              const outcomes: Record<string, { completed?: boolean; score?: number }> = {};
              for (const key of stepKeys) {
                const entry: { completed?: boolean; score?: number } = {};
                if (completed[key]) entry.completed = true;
                if (scores[key]?.trim()) entry.score = Number(scores[key]);
                if (Object.keys(entry).length > 0) outcomes[key] = entry;
              }
              try {
                await evaluate.mutateAsync({
                  assignmentId: assignment.id,
                  // Read from the row rather than counted locally: a stale value is exactly what the
                  // server's conflict check exists to catch, and inventing one would defeat it.
                  expectedStateVersion: assignment.state_version,
                  outcomes,
                });
                toast({ title: "Path evaluated", description: "Each step's transition is recorded with its reason." });
                setOpen(false);
              } catch (error) {
                toast({ title: "Evaluation blocked", description: errorMessage(error), variant: "destructive" });
              }
            }}
          >
            Record outcomes
          </Button>
        </div>
      )}
    </div>
  );
}

export function AdaptivePathsPanel() {
  const { user } = useAuth();
  const versions = useLearningPathVersions();
  const publish = usePublishLearningPathVersion();
  const assign = useAssignLearningPath();
  const employees = useListEmployees({ organizationId: user?.organizationId ?? undefined });
  const { toast } = useToast();
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [assignEmployeeId, setAssignEmployeeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const assignments = useLearningPathAssignments(selectedVersionId || undefined);

  const rows = versions.data ?? [];
  const selected = rows.find((row) => row.id === selectedVersionId);
  const selectedSteps = selected
    ? ((selected.definition as { steps?: { key: string }[] } | null)?.steps ?? []).map((step) => step.key)
    : [];

  return (
    <div className="space-y-4">
      <AuthorPathCard />

      {versions.isError && (
        <QueryError what="learning paths" error={versions.error} onRetry={() => void versions.refetch()} />
      )}
      {!versions.isLoading && !versions.isError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No path versions yet. Author one above to start.</p>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Path versions</CardTitle>
            <CardDescription>
              Publishing freezes a version. Assignments pin the version they were made against, so somebody
              midway through keeps the steps they started under.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((version) => (
              <div key={version.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {version.definition_row?.name ?? "Unnamed path"} · v{version.version_number}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {version.definition_sha256.slice(0, 12)}…
                    {version.published_at ? ` · published ${new Date(version.published_at).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={version.state === "published" ? "default" : version.state === "draft" ? "secondary" : "outline"}>
                    {version.state}
                  </Badge>
                  {version.state === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={publish.isPending}
                      onClick={async () => {
                        try {
                          await publish.mutateAsync({ versionId: version.id });
                          toast({ title: "Path version published" });
                        } catch (error) {
                          toast({ title: "Publication blocked", description: errorMessage(error), variant: "destructive" });
                        }
                      }}
                    >
                      <Send className="mr-1 h-4 w-4" />Publish
                    </Button>
                  )}
                  {version.state === "published" && (
                    <Button size="sm" variant={selectedVersionId === version.id ? "default" : "outline"}
                      onClick={() => setSelectedVersionId(selectedVersionId === version.id ? "" : version.id)}>
                      Assignments
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selected.definition_row?.name} v{selected.version_number} assignments
            </CardTitle>
            <CardDescription>
              Evaluating an assignment records one explainable transition per step and advances its state
              version. Two people evaluating the same assignment cannot both win — the second is refused.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1 space-y-1.5">
                <Label htmlFor="path-assign-employee">Assign to</Label>
                <Select value={assignEmployeeId} onValueChange={setAssignEmployeeId}>
                  <SelectTrigger id="path-assign-employee"><SelectValue placeholder="Choose an employee" /></SelectTrigger>
                  <SelectContent>
                    {employees.isLoading ? (
                      <SelectItem value="none" disabled>Loading employees…</SelectItem>
                    ) : employees.isError ? (
                      <SelectItem value="none" disabled>Could not load employees</SelectItem>
                    ) : (employees.data ?? []).length === 0 ? (
                      <SelectItem value="none" disabled>No active employees</SelectItem>
                    ) : (
                      (employees.data ?? []).map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.last_name}, {employee.first_name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="path-assign-due">Due (optional)</Label>
                <Input id="path-assign-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </div>
              <Button
                disabled={!assignEmployeeId || assign.isPending}
                onClick={async () => {
                  try {
                    await assign.mutateAsync({
                      employeeId: assignEmployeeId,
                      pathVersionId: selected.id,
                      dueAt: dueAt ? facilityDayBounds(dueAt).through : null,
                    });
                    toast({ title: "Path assigned" });
                    setAssignEmployeeId("");
                    setDueAt("");
                  } catch (error) {
                    toast({ title: "Assignment blocked", description: errorMessage(error), variant: "destructive" });
                  }
                }}
              >
                Assign
              </Button>
            </div>

            {assignments.isError && (
              <QueryError what="assignments" error={assignments.error} onRetry={() => void assignments.refetch()} />
            )}
            {!assignments.isLoading && !assignments.isError && (assignments.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Nobody is on this path version yet.</p>
            )}
            {(assignments.data ?? []).map((assignment) => (
              <AssignmentRow key={assignment.id} assignment={assignment} stepKeys={selectedSteps} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
