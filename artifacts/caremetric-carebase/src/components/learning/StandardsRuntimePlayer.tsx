import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, CheckCircle2, ExternalLink, Loader2, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  createPackageContentSignedUrl,
  useAcceptedLearningPackages,
  useCommitLearningRuntimeState,
  useIngestXapiStatement,
  useStartLearningRuntimeSession,
} from "@/hooks/useLearningRuntime";
import {
  buildRuntimeInitMessage,
  courseObjectIri,
  isCompletedCommit,
  isRuntimeHandshakeRequest,
  normalizeRuntimeCommitState,
  parseRuntimeBridgeMessage,
  XAPI_VERBS,
  type LaunchSession,
  type RuntimeCommitState,
} from "@/lib/learningRuntime";

interface StandardsRuntimePlayerProps {
  assignmentId: string;
  courseId: string;
  courseVersionId: string | undefined;
  blockId?: string | null;
  /** When no accepted package exists, fall back to document link UX. */
  fallback?: ReactNode;
  onCompleted?: (state: RuntimeCommitState) => void;
}

/**
 * Learner-facing SCORM / xAPI runtime.
 *
 * - Starts a governed session via start_learning_runtime_session.
 * - Listens for fixed-schema postMessage commits from a sandboxed package frame.
 * - Also exposes explicit progress/complete actions so packages without a working
 *   content origin still produce server-side commits and xAPI statements.
 */
export function StandardsRuntimePlayer({
  assignmentId,
  courseId,
  courseVersionId,
  blockId,
  fallback,
  onCompleted,
}: StandardsRuntimePlayerProps) {
  const { toast } = useToast();
  const packages = useAcceptedLearningPackages(courseVersionId);
  const startSession = useStartLearningRuntimeSession();
  const commitState = useCommitLearningRuntimeState();
  const ingestXapi = useIngestXapiStatement();

  const [launch, setLaunch] = useState<LaunchSession | null>(null);
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [status, setStatus] = useState<string>("Ready to launch");
  const sequenceRef = useRef(1);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const hasPackage = (packages.data?.length ?? 0) > 0;

  const pushXapi = useCallback(async (session: LaunchSession, verb: string, result: Record<string, unknown> = {}) => {
    try {
      await ingestXapi.mutateAsync({
        statementId: crypto.randomUUID(),
        sessionId: session.sessionId,
        employeeId: session.employeeId,
        verbIri: verb,
        objectIri: courseObjectIri(courseId, blockId),
        result,
        context: { registration: session.registrationKey, standard: session.standard },
      });
    } catch {
      // xAPI is best-effort beside the authoritative SCORM commit path.
    }
  }, [blockId, courseId, ingestXapi]);

  const applyCommit = useCallback(async (session: LaunchSession, raw: Record<string, unknown>, idempotencyKey: string) => {
    const normalized = normalizeRuntimeCommitState(raw);
    const seq = sequenceRef.current;
    try {
      await commitState.mutateAsync({
        sessionId: session.sessionId,
        sequenceNumber: seq,
        idempotencyKey,
        state: normalized,
      });
      sequenceRef.current = seq + 1;
      if (normalized.progress != null) setProgress(Math.round(normalized.progress * 100));
      if (isCompletedCommit(normalized)) {
        setCompleted(true);
        setStatus("Completed — progress saved");
        await pushXapi(session, normalized.successStatus === "failed" ? XAPI_VERBS.failed : XAPI_VERBS.completed, {
          score: normalized.scoreRaw,
          completion: true,
        });
        onCompleted?.(normalized);
      } else {
        setStatus("Progress saved");
        await pushXapi(session, XAPI_VERBS.progressed, { progress: normalized.progress });
      }
    } catch (err) {
      toast({
        title: "Could not save learning progress",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [commitState, onCompleted, pushXapi, toast]);

  const handleLaunch = async () => {
    setStatus("Starting session…");
    try {
      const next = await startSession.mutateAsync({
        assignmentId,
        packageId: packages.data?.[0]?.id,
      });
      setLaunch(next);
      // Resume numbering where this session left off. Relaunching an in-progress package reuses
      // the existing session and its commits, and the commit RPC rejects anything other than
      // max(sequence_number) + 1, so restarting at 1 broke every save after the first launch.
      sequenceRef.current = next.nextSequenceNumber;
      setCompleted(false);
      setProgress(0);
      await pushXapi(next, XAPI_VERBS.initialized);
      const signed = await createPackageContentSignedUrl(next.storageBucket, next.storagePath);
      setContentUrl(signed);
      setStatus(signed ? "Package ready" : "Session active (package content URL unavailable — use manual progress)");
    } catch (err) {
      setStatus("Launch failed");
      toast({
        title: "Could not launch interactive package",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  // The frame is sandboxed without allow-same-origin, so its origin is opaque and it cannot read
  // anything from this page. The nonce therefore has to be handed to it explicitly, or no package
  // can ever produce a message parseRuntimeBridgeMessage accepts and the bridge is inert. targetOrigin
  // has to be "*" because an opaque origin cannot be named -- the message still goes only to this
  // one frame's window, and `postToFrame` is never called with anything but our own iframe.
  const sendRuntimeInit = useCallback((session: LaunchSession) => {
    const frame = iframeRef.current?.contentWindow;
    const message = buildRuntimeInitMessage(session);
    if (!frame || !message) return;
    frame.postMessage(message, "*");
  }, []);

  useEffect(() => {
    if (!launch?.launchNonce) return;
    const onMessage = (event: MessageEvent) => {
      // Only the frame we launched may drive this session. Without this, any window holding the
      // nonce could commit progress on the learner's behalf.
      if (!iframeRef.current?.contentWindow || event.source !== iframeRef.current.contentWindow) return;

      // The one message a package can send before it has been given the nonce.
      if (isRuntimeHandshakeRequest(event.data)) {
        sendRuntimeInit(launch);
        return;
      }

      const parsed = parseRuntimeBridgeMessage(event.data, launch.launchNonce);
      if (!parsed) return;
      if (parsed.type === "ready") {
        setStatus("Package connected");
        return;
      }
      if (parsed.type === "error") {
        setStatus(String(parsed.payload.message ?? "Package error"));
        return;
      }
      if (parsed.type === "commit") {
        void applyCommit(launch, parsed.payload, `bridge-${sequenceRef.current}-${Date.now()}`);
      }
      if (parsed.type === "xapi" && typeof parsed.payload.verb === "string" && typeof parsed.payload.object === "string") {
        void ingestXapi.mutateAsync({
          statementId: String(parsed.payload.id ?? crypto.randomUUID()),
          sessionId: launch.sessionId,
          employeeId: launch.employeeId,
          verbIri: String(parsed.payload.verb),
          objectIri: String(parsed.payload.object),
          result: (parsed.payload.result as Record<string, unknown>) ?? {},
          context: (parsed.payload.context as Record<string, unknown>) ?? {},
        }).catch(() => undefined);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applyCommit, ingestXapi, launch, sendRuntimeInit]);

  if (packages.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking for interactive package…
      </div>
    );
  }

  if (!hasPackage) {
    return <>{fallback ?? null}</>;
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <BookOpen className="h-4 w-4 shrink-0" />
            Interactive package ({packages.data?.[0]?.standard_type?.replaceAll("_", " ") ?? "SCORM / xAPI"})
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!launch ? (
            <Button size="sm" onClick={() => void handleLaunch()} disabled={startSession.isPending}>
              {startSession.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Launch
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void handleLaunch()} disabled={startSession.isPending}>
              <RefreshCw className="mr-2 h-4 w-4" /> Relaunch
            </Button>
          )}
          {contentUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={contentUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Open package file
              </a>
            </Button>
          )}
        </div>
      </div>

      {launch && (
        <>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{completed ? "Complete" : `${progress}%`}</span>
            </div>
            <Progress value={completed ? 100 : progress} />
          </div>

          {contentUrl && (
            <iframe
              ref={iframeRef}
              title="Learning package"
              src={contentUrl}
              className="h-[min(70vh,520px)] w-full rounded-md border bg-background"
              sandbox="allow-scripts allow-forms allow-popups"
              // Intentionally omit allow-same-origin per Phase 4: bridge only, no cookie jar.
              // Push the launch credentials as soon as the document is up. A package that registers
              // its listener later can still ask for them with a `hello` message.
              onLoad={() => sendRuntimeInit(launch)}
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={commitState.isPending || completed}
              onClick={() => void applyCommit(launch, { progress: Math.min(1, (progress + 25) / 100), completionStatus: "incomplete" }, `manual-progress-${sequenceRef.current}`)}
            >
              Save progress
            </Button>
            <Button
              size="sm"
              disabled={commitState.isPending || completed}
              onClick={() => void applyCommit(launch, { progress: 1, completionStatus: "completed", successStatus: "passed" }, `manual-complete-${sequenceRef.current}`)}
            >
              {completed ? (
                <><CheckCircle2 className="mr-2 h-4 w-4" /> Completed</>
              ) : (
                "Mark package complete"
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Progress is committed server-side through the governed runtime. Packages that post SCORM/xAPI
            messages are recorded automatically; otherwise use the buttons above.
          </p>
        </>
      )}
    </div>
  );
}
