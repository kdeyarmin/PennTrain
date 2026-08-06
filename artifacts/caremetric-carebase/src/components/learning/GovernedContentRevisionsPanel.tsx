/**
 * The governed publication control, end to end (BACKLOG.md G10).
 *
 * What this replaces: a text box asking for a revision UUID and two buttons that could only ever
 * approve or return something no surface could create. Author, submit and publish had no caller at
 * all; the revision ID had to come from somebody reading the database by hand.
 *
 * The snapshot is built from the course version's own rows rather than typed, because the server
 * hashes it and stores the digest as the record of what was approved -- a hand-composed snapshot
 * would attest to content nobody read.
 */
import { useEffect, useMemo, useState } from "react";
import { FileCheck2, Loader2, PlusCircle, ShieldCheck } from "lucide-react";
import {
  useCreateGovernedRevision,
  useGovernedContentAssets,
  useGovernedContentRevisions,
  usePublishGovernedRevision,
  useRegisterGovernedAsset,
  useReviewGovernedRevision,
  useSubmitGovernedRevision,
  type GovernedContentRevision,
} from "@/hooks/useGovernedContentRevisions";
import { useListCourseBlocks, useListCourses, useListCourseVersions } from "@/hooks/useCourses";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  buildCourseSnapshot,
  createFormIssues,
  hasBlockingFindings,
  MATERIAL_CHANGE_ACTION_LABELS,
  nextStep,
  reasonIssue,
  revisionStateLabel,
  stepBlocker,
  validateCourseSnapshot,
  type CourseSnapshot,
  type MaterialChangeAction,
} from "@/lib/governedContentRevision";
import { QueryError } from "@/components/QueryState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function StateBadge({ state }: { state: string }) {
  const variant =
    state === "published" ? "default"
    : state === "changes_requested" ? "destructive"
    : state === "superseded" || state === "retired" ? "outline"
    : "secondary";
  return <Badge variant={variant}>{revisionStateLabel(state)}</Badge>;
}

/** Bring a course under governance — the row every revision hangs off, which nothing could create. */
function RegisterAssetCard({ governedSourceIds }: { governedSourceIds: Set<string> }) {
  const courses = useListCourses();
  const register = useRegisterGovernedAsset();
  const { toast } = useToast();
  const [courseId, setCourseId] = useState("");

  // Platform catalogue courses are governed by the platform; the server refuses a tenant
  // registering one, so they are not offered.
  const candidates = (courses.data ?? []).filter(
    (course) => course.organization_id !== null && !governedSourceIds.has(course.id),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bring a course under governance</CardTitle>
        <CardDescription>
          A governed course can only change through an authored revision that a second person reviews and a
          second person publishes. Registering does not change the course itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1 space-y-2">
          <Label htmlFor="gc-register-course">Course</Label>
          <Select value={courseId} onValueChange={setCourseId}>
            <SelectTrigger id="gc-register-course">
              <SelectValue placeholder={candidates.length ? "Choose a course" : "Every course is already governed"} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((course) => (
                <SelectItem key={course.id} value={course.id}>{course.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          disabled={!courseId || register.isPending}
          onClick={async () => {
            try {
              await register.mutateAsync({ courseId });
              toast({ title: "Course is now under governed publication control" });
              setCourseId("");
            } catch (error) {
              toast({ title: "Registration blocked", description: errorMessage(error), variant: "destructive" });
            }
          }}
        >
          {register.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          Register
        </Button>
      </CardContent>
    </Card>
  );
}

function AuthorRevisionCard({ assetId, sourceCourseId }: { assetId: string; sourceCourseId: string }) {
  const versions = useListCourseVersions(sourceCourseId);
  const create = useCreateGovernedRevision();
  const { toast } = useToast();
  const [sourceVersionId, setSourceVersionId] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [materialChange, setMaterialChange] = useState(false);
  const [materialChangeAction, setMaterialChangeAction] = useState<MaterialChangeAction>("none");
  const blocks = useListCourseBlocks(sourceVersionId || undefined);

  // Switching asset must not carry the previous asset's version selection across.
  useEffect(() => { setSourceVersionId(""); }, [sourceCourseId]);

  const version = (versions.data ?? []).find((row) => row.id === sourceVersionId);
  const snapshot = useMemo(
    () => (version ? buildCourseSnapshot(version, blocks.data ?? []) : null),
    [version, blocks.data],
  );
  const findings = snapshot ? validateCourseSnapshot(snapshot) : [];
  const blocked = hasBlockingFindings(findings);
  const issues = createFormIssues({
    assetId, sourceVersionId, changeSummary, materialChange, materialChangeAction,
  });
  const blocksLoading = !!sourceVersionId && blocks.isLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Author a revision</CardTitle>
        <CardDescription>
          The snapshot is taken from the chosen version's own blocks and hashed by the server. Re-snapshotting
          an unchanged version produces the same hash, so a reviewer can tell nothing really moved.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="gc-version">Source version</Label>
          <Select value={sourceVersionId} onValueChange={setSourceVersionId}>
            <SelectTrigger id="gc-version"><SelectValue placeholder="Choose a version to snapshot" /></SelectTrigger>
            <SelectContent>
              {(versions.data ?? []).map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  v{row.version_number} · {row.title} · {row.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="gc-material-action">If prior completers are affected</Label>
          <Select
            value={materialChangeAction}
            onValueChange={(value) => setMaterialChangeAction(value as MaterialChangeAction)}
            disabled={!materialChange}
          >
            <SelectTrigger id="gc-material-action"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(MATERIAL_CHANGE_ACTION_LABELS).map(([value, text]) => (
                <SelectItem key={value} value={value}>{text}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="gc-summary">What changed</Label>
          <Textarea
            id="gc-summary"
            value={changeSummary}
            onChange={(event) => setChangeSummary(event.target.value)}
            placeholder="Reworked the wandering-response section after the 2800.104 citation"
          />
        </div>
        <div className="flex items-start gap-2 md:col-span-2">
          <Checkbox
            id="gc-material"
            checked={materialChange}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setMaterialChange(next);
              if (!next) setMaterialChangeAction("none");
            }}
          />
          <Label htmlFor="gc-material" className="text-sm font-normal leading-snug">
            This is a material change — people who already completed the course have been taught something
            that is no longer correct.
          </Label>
        </div>

        {snapshot && (
          <div className="md:col-span-2 space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">
              Snapshot: {snapshot.blocks.length} block{snapshot.blocks.length === 1 ? "" : "s"} from v{snapshot.versionNumber}
            </p>
            {findings.length === 0 && <p className="text-xs text-muted-foreground">No validation findings.</p>}
            {findings.map((finding) => (
              <p
                key={finding.code}
                className={finding.severity === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
              >
                {finding.severity === "error" ? "Blocking" : "Warning"}: {finding.message}
              </p>
            ))}
            {blocked && (
              <p className="text-xs text-muted-foreground">
                A revision can still be authored, but the server will not accept it for review until the
                blocking findings are fixed in the course itself.
              </p>
            )}
          </div>
        )}

        <div className="md:col-span-2">
          {issues.map((issue) => <p key={issue} className="mb-2 text-xs text-muted-foreground">{issue}</p>)}
          <Button
            disabled={issues.length > 0 || !snapshot || blocksLoading || create.isPending}
            onClick={async () => {
              if (!snapshot) return;
              try {
                await create.mutateAsync({
                  assetId, sourceVersionId, changeSummary, materialChange, materialChangeAction, snapshot,
                });
                toast({ title: "Revision authored", description: "It stays a draft until you submit it for review." });
                setChangeSummary("");
                setMaterialChange(false);
                setMaterialChangeAction("none");
              } catch (error) {
                toast({ title: "Authoring blocked", description: errorMessage(error), variant: "destructive" });
              }
            }}
          >
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
            Author revision
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RevisionRow({
  revision,
  sourceCourseId,
}: {
  revision: GovernedContentRevision;
  sourceCourseId: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const submit = useSubmitGovernedRevision();
  const review = useReviewGovernedRevision();
  const publish = usePublishGovernedRevision();
  const [reason, setReason] = useState("");
  const step = nextStep(revision.state);
  const blocker = stepBlocker(
    {
      id: revision.id,
      asset_id: revision.asset_id,
      revision_number: revision.revision_number,
      state: revision.state,
      change_summary: revision.change_summary,
      material_change: revision.material_change,
      material_change_action: revision.material_change_action,
      snapshot_sha256: revision.snapshot_sha256,
      authored_by: revision.authored_by,
      reviewed_by: revision.reviewed_by,
      published_at: revision.published_at,
      created_at: revision.created_at,
    },
    user?.id ?? null,
  );

  // The frozen snapshot, not the live course rows. This used to re-derive from whatever the source
  // version says now, which describes something nobody is approving: the revision carries its own
  // `snapshot` and `snapshot_sha256`, the server validates and publishes that, and the footer below
  // already tells the reader it is frozen. Re-deriving got it wrong in both directions -- a stale
  // broken snapshot submitted cleanly once the source was fixed, and a good snapshot blocked by a
  // regression landed in the source afterwards.
  const findings = validateCourseSnapshot(revision.snapshot as unknown as CourseSnapshot);
  const pending = submit.isPending || review.isPending || publish.isPending;
  const reasonProblem = reasonIssue(reason, step === "publish" ? "publication" : "review");

  const act = async (run: () => Promise<unknown>, success: string) => {
    try {
      await run();
      toast({ title: success });
      setReason("");
    } catch (error) {
      toast({ title: "Blocked", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Revision {revision.revision_number} · {revision.change_summary}</p>
          <p className="text-xs text-muted-foreground">
            {revision.snapshot_sha256.slice(0, 12)}… · authored {new Date(revision.created_at).toLocaleString()}
            {revision.material_change ? ` · material change: ${revision.material_change_action}` : ""}
          </p>
          {revision.review_reason && (
            <p className="mt-1 text-xs text-muted-foreground">Review note: {revision.review_reason}</p>
          )}
        </div>
        <StateBadge state={revision.state} />
      </div>

      {step !== "none" && blocker && <p className="text-xs text-muted-foreground">{blocker}</p>}

      {step === "submit" && !blocker && (
        <div className="space-y-2">
          {findings.map((finding) => (
            <p
              key={finding.code}
              className={finding.severity === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
            >
              {finding.severity === "error" ? "Blocking" : "Warning"}: {finding.message}
            </p>
          ))}
          <Button
            size="sm"
            disabled={pending || hasBlockingFindings(findings)}
            onClick={() => act(
              () => submit.mutateAsync({ revisionId: revision.id, findings }),
              "Submitted for independent review",
            )}
          >
            Submit for review
          </Button>
          {hasBlockingFindings(findings) && (
            <p className="text-xs text-muted-foreground">
              Fix the blocking findings in the course, then author a fresh revision — this snapshot is frozen.
            </p>
          )}
        </div>
      )}

      {(step === "review" || step === "publish") && !blocker && (
        <div className="space-y-2">
          <Label htmlFor={`gc-reason-${revision.id}`} className="text-xs">
            {step === "review" ? "Review reason" : "Publication reason"}
          </Label>
          <Textarea
            id={`gc-reason-${revision.id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            placeholder={step === "review"
              ? "What you checked, and against what"
              : "Why this is being released now"}
          />
          {reasonProblem && <p className="text-xs text-muted-foreground">{reasonProblem}</p>}
          <div className="flex flex-wrap gap-2">
            {step === "review" ? (
              <>
                <Button
                  size="sm"
                  disabled={pending || !!reasonProblem}
                  onClick={() => act(
                    () => review.mutateAsync({ revisionId: revision.id, decision: "approve", reason }),
                    "Approved — it still needs a separate person to publish it",
                  )}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !!reasonProblem}
                  onClick={() => act(
                    () => review.mutateAsync({ revisionId: revision.id, decision: "request_changes", reason }),
                    "Returned to the author",
                  )}
                >
                  Request changes
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                disabled={pending || !!reasonProblem}
                onClick={() => act(
                  () => publish.mutateAsync({ revisionId: revision.id, reason }),
                  "Published — the previous revision is now superseded",
                )}
              >
                Publish
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function GovernedContentRevisionsPanel() {
  const assets = useGovernedContentAssets();
  const [assetId, setAssetId] = useState("");
  const revisions = useGovernedContentRevisions(assetId || undefined);

  const rows = assets.data ?? [];
  const selected = rows.find((asset) => asset.id === assetId);
  const governedSourceIds = useMemo(() => new Set(rows.map((asset) => asset.source_id)), [rows]);

  // Land on the first asset so the page opens on something actionable rather than an empty selector.
  useEffect(() => {
    if (!assetId && rows.length > 0) setAssetId(rows[0].id);
  }, [assetId, rows]);

  return (
    <div className="space-y-4">
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Four steps, and never fewer than two people</AlertTitle>
        <AlertDescription>
          An author snapshots a version, a second person reviews it, and a third step publishes it — the
          server refuses an author who tries to review or publish their own work.
        </AlertDescription>
      </Alert>

      {assets.isError && (
        <QueryError what="governed assets" error={assets.error} onRetry={() => void assets.refetch()} />
      )}

      <RegisterAssetCard governedSourceIds={governedSourceIds} />

      {!assets.isLoading && !assets.isError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No course is under governed publication control yet. Register one above to start.
        </p>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Governed assets</CardTitle>
            <CardDescription>Revisions, newest first. Only the top one is normally still moving.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gc-asset">Asset</Label>
              <Select value={assetId} onValueChange={setAssetId}>
                <SelectTrigger id="gc-asset"><SelectValue placeholder="Choose a governed asset" /></SelectTrigger>
                <SelectContent>
                  {rows.map((asset) => (
                    <SelectItem key={asset.id} value={asset.id}>{asset.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {revisions.isError && (
              <QueryError what="revisions" error={revisions.error} onRetry={() => void revisions.refetch()} />
            )}
            {revisions.isLoading && <p className="text-sm text-muted-foreground">Loading revisions…</p>}
            {!revisions.isLoading && !revisions.isError && (revisions.data ?? []).length === 0 && selected && (
              <p className="text-sm text-muted-foreground">
                <FileCheck2 className="mr-1 inline h-4 w-4" />
                No revisions yet — this asset is governed but has never been changed under governance.
              </p>
            )}
            {(revisions.data ?? []).map((revision) => (
              <RevisionRow key={revision.id} revision={revision} sourceCourseId={selected?.source_id ?? ""} />
            ))}
          </CardContent>
        </Card>
      )}

      {selected && <AuthorRevisionCard assetId={selected.id} sourceCourseId={selected.source_id} />}
    </div>
  );
}
