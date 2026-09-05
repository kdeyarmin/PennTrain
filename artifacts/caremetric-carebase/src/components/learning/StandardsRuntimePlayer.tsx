import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ExternalLink, Loader2, Play, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  createPackageContentSignedUrl,
  useAcceptedLearningPackages,
  useAssignmentPackageCompleted,
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
  RUNTIME_FRAME_SANDBOX,
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

  // Whether this package has EVER reported completion for this assignment, from the commit
  // ledger. Without it the step forgot itself on reload: `completed` is component state, and
  // relaunching a finished package resets learning_runtime_sessions.state to 'active', so a
  // learner who came back to the course was told to do it again.
  const priorCompletion = useAssignmentPackageCompleted(assignmentId);

  const [launch, setLaunch] = useState<LaunchSession | null>(null);
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [completedInSession, setCompletedInSession] = useState(false);
  const completed = completedInSession || priorCompletion.data === true;
  const [status, setStatus] = useState<string>("Ready to launch");
  const sequenceRef = useRef(1);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Commits must reach the server one at a time. commit_learning_runtime_state requires
  // max(sequence_number) + 1, and sequenceRef only advances once a commit succeeds, so two
  // commits started concurrently both claim the same number and the server rejects the loser
  // with a sequence conflict. A package that reports progress and completion in one burst would
  // otherwise lose the completion.
  const commitQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  // Idempotency keys must be unique per intent for the whole life of the server session, which is
  // reused across launches (one session row per package+assignment). The server dedupes on
  // (session, key) before checking the sequence, so any repeated key -- sequence+timestamp within
  // one burst, or a per-mount counter on a later visit -- makes it hand back an old commit as if
  // the new one were saved, desynchronizing every commit after it. Each commit mints a fresh UUID.
  /** Handshake must complete within this window or the learner sees an explicit recovery path. */
  const HANDSHAKE_TIMEOUT_MS = 12_000;
  const handshakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [handshakeState, setHandshakeState] = useState<"idle" | "waiting" | "connected" | "timed_out" | "error">("idle");
  const [handshakeError, setHandshakeError] = useState<string | null>(null);

  const clearHandshakeTimer = useCallback(() => {
    if (handshakeTimerRef.current != null) {
      clearTimeout(handshakeTimerRef.current);
      handshakeTimerRef.current = null;
    }
  }, []);

  const startHandshakeWatch = useCallback(() => {
    clearHandshakeTimer();
    setHandshakeState("waiting");
    setHandshakeError(null);
    handshakeTimerRef.current = setTimeout(() => {
      setHandshakeState((prev) => (prev === "connected" ? prev : "timed_out"));
      setStatus((prev) => (prev === "Package connected" ? prev : "Package runtime not connected"));
    }, HANDSHAKE_TIMEOUT_MS);
  }, [clearHandshakeTimer]);

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
        setCompletedInSession(true);
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

  /**
   * Serialize a commit behind any still in flight, so each one sees the sequence number the
   * previous one produced. Failures are swallowed here because applyCommit already surfaces them
   * to the learner -- the queue's job is only to keep the chain alive for the next commit.
   */
  const enqueueCommit = useCallback((session: LaunchSession, raw: Record<string, unknown>, label: string) => {
    const idempotencyKey = `${label}-${crypto.randomUUID()}`;
    commitQueueRef.current = commitQueueRef.current
      .catch(() => undefined)
      .then(() => applyCommit(session, raw, idempotencyKey));
    return commitQueueRef.current;
  }, [applyCommit]);

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
      setCompletedInSession(false);
      setProgress(0);
      clearHandshakeTimer();
      setHandshakeState("idle");
      setHandshakeError(null);
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
        clearHandshakeTimer();
        setHandshakeState("connected");
        setHandshakeError(null);
        setStatus("Package connected");
        return;
      }
      if (parsed.type === "error") {
        clearHandshakeTimer();
        const message = String(parsed.payload.message ?? "Package error");
        setHandshakeState("error");
        setHandshakeError(message);
        setStatus(message);
        return;
      }
      if (parsed.type === "commit") {
        void enqueueCommit(launch, parsed.payload, "bridge");
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
  }, [clearHandshakeTimer, enqueueCommit, ingestXapi, launch, sendRuntimeInit]);

  useEffect(() => () => clearHandshakeTimer(), [clearHandshakeTimer]);

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
          {(handshakeState === "timed_out" || handshakeState === "error") && (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {handshakeState === "timed_out"
                  ? "Package runtime not connected"
                  : "Package reported an error"}
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  {handshakeState === "timed_out"
                    ? "Automatic progress may not record. The package did not complete the CareBase handshake within 12 seconds — often because the adapter was not bundled into the package or could not load on this network."
                    : (handshakeError ?? "The package reported a runtime error.")}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      sendRuntimeInit(launch);
                      startHandshakeWatch();
                      setStatus("Retrying handshake…");
                    }}
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry handshake
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleLaunch()}
                    disabled={startSession.isPending}
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" /> Relaunch
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  You can still use Save progress / Mark package complete below — those writes go through the governed server path.
                </p>
              </AlertDescription>
            </Alert>
          )}

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
              sandbox={RUNTIME_FRAME_SANDBOX}
              // Push the launch credentials as soon as the document is up. A package that registers
              // its listener later can still ask for them with a `hello` message.
              onLoad={() => {
                sendRuntimeInit(launch);
                startHandshakeWatch();
              }}
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={commitState.isPending || completed}
              onClick={() => void enqueueCommit(launch, { progress: Math.min(1, (progress + 25) / 100), completionStatus: "incomplete" }, "manual-progress")}
            >
              Save progress
            </Button>
            <Button
              size="sm"
              disabled={commitState.isPending || completed}
              onClick={() => void enqueueCommit(launch, { progress: 1, completionStatus: "completed", successStatus: "passed" }, "manual-complete")}
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
          <p className="text-xs text-muted-foreground">
            {completed
              ? "This package is recorded as complete. Continue through the rest of the course and mark the course complete at the end -- that is what issues your certificate."
              : "Completing this package finishes this step only. The course is completed at the end, which is what issues your certificate."}
          </p>
        </>
      )}
    </div>
  );
}
