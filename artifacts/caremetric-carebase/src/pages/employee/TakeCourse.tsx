import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { facilityDaysUntil, formatDateForDisplay, formatDueDistance } from "@/lib/dateUtils";
import { sanitizeVideoState, type VideoBlockState } from "@/lib/videoWatchState";
import { CourseVideoPlayer } from "@/components/CourseVideoPlayer";
import { StandardsRuntimePlayer } from "@/components/learning/StandardsRuntimePlayer";
import type { Json } from "@/lib/database.types";
import { Link, useLocation, useParams } from "wouter";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import {
  useGetCourseAssignment,
  useGetCourseProgress,
  useUpsertCourseProgress,
  useCompleteCourseAssignment,
  useStartCourseAssignment,
} from "@/hooks/useCourseAssignments";
import { useGetCourse, useListCourseBlocks, type CourseBlock } from "@/hooks/useCourses";
import { useGetQuizByBlockId, useListQuizAttempts } from "@/hooks/useQuizzes";
import { useGetDocument, useDocumentSignedUrl } from "@/hooks/useDocuments";
import { useGetCourseFeedbackForAssignment, useCreateCourseFeedback } from "@/hooks/useCourseFeedback";
import {
  useListCourseAttestations,
  useRecordCourseAttestation,
  parseAttestationBlock,
} from "@/hooks/useCourseAttestations";
import { useToast } from "@/hooks/use-toast";
import {
  buildStudyGuide,
  canAdvanceCourseStep,
  canMutateCourseEvidence,
  CONFIDENCE_LABEL,
  estimateBlockMinutes,
  getBlockLabel,
  getLearningStepLabel,
  getTextPreview,
  hasLearningToolsEntries,
  isAppliedResponseComplete,
  lessonStorageKey,
  MIN_APPLIED_RESPONSE_CHARACTERS,
  parseLearningToolsState,
  requiresAppliedResponse,
  requiresAttestation,
  sanitizeLearningToolsState,
  shouldEnableCourseShortcuts,
  type LearningToolsState,
  type LessonConfidence,
} from "@/lib/courseLearningTools";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { QueryError } from "@/components/QueryState";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, Clock, Copy, Download, FileText, Lightbulb, ListChecks, RotateCcw, ShieldCheck, Trash2, Video, BookOpen, Star, Target,
  type LucideIcon,
} from "lucide-react";

function DocumentBlockLink({ documentId }: { documentId: string | null }) {
  const { data: document, isLoading } = useGetDocument(documentId ?? undefined);
  const getSignedUrl = useDocumentSignedUrl();
  const { toast } = useToast();

  if (!documentId) {
    return <p className="text-sm text-muted-foreground">No document attached to this lesson.</p>;
  }
  if (isLoading) {
    return <div className="h-9 w-40 bg-muted animate-pulse rounded" />;
  }
  if (!document) {
    return <p className="text-sm text-muted-foreground">The attached document could not be found.</p>;
  }

  const handleOpen = async () => {
    try {
      const url = await getSignedUrl.mutateAsync(document);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({ title: "Failed to open document", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Button onClick={handleOpen} disabled={getSignedUrl.isPending}>
      <Download className="mr-2 h-4 w-4" />
      {getSignedUrl.isPending ? "Opening..." : `Open ${document.file_name}`}
    </Button>
  );
}

const BLOCK_ICON: Record<string, LucideIcon> = {
  text: FileText,
  video: Video,
  pdf: FileText,
  scorm: BookOpen,
  quiz: ListChecks,
};

type ReadingComfort = "standard" | "comfortable" | "large";

const READING_COMFORT_CLASS: Record<ReadingComfort, string> = {
  standard: "text-sm leading-6",
  comfortable: "text-sm leading-7",
  large: "text-base leading-8",
};

const READING_COMFORT_LABEL: Record<ReadingComfort, string> = {
  standard: "Standard",
  comfortable: "Comfort",
  large: "Large",
};

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

// Mirrors StatusPill in src/pages/app/CourseAssignments.tsx -- the in_progress/overdue values
// this reads had display styling waiting for them since that page shipped, but no code path ever
// wrote those statuses until this (Tier 3.4's start_course_assignment RPC + nightly recompute).
function AssignmentStatusBadge({ status }: { status: string }) {
  const className =
    status === "completed" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "overdue" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : status === "in_progress" ? "bg-info text-info-foreground hover:bg-info/80"
    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"; // assigned
  return <Badge className={className} variant="outline">{status.replace(/_/g, " ")}</Badge>;
}

export default function TakeCourse() {
  const __fieldIds = useId();
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Every role can reach this page (App.tsx ANY_ROLE). Always return to the assignment list
  // (/me/courses) — not Training Records, which is a read-only compliance history with no
  // Start/Continue actions. Certificates remain the post-completion destination for employees.
  const isEmployeeRole = user?.role === "employee";
  const backHref = "/me/courses";
  const backLabel = "Back to My Training";

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const {
    data: assignment,
    isLoading: assignmentLoading,
    isError: assignmentError,
    error: assignmentErrorDetail,
    refetch: refetchAssignment,
  } = useGetCourseAssignment(assignmentId);
  const { data: course } = useGetCourse(assignment?.course_id);
  const {
    data: blocks,
    isLoading: blocksLoading,
    isError: blocksError,
    error: blocksErrorDetail,
    refetch: refetchBlocks,
  } = useListCourseBlocks(assignment?.course_version_id);
  const {
    data: progress,
    isLoading: progressLoading,
    isError: progressError,
    error: progressErrorDetail,
    refetch: refetchProgress,
  } = useGetCourseProgress(assignmentId);
  const { data: quizAttempts } = useListQuizAttempts({ assignmentId });
  const ownsAssignment = !!assignment && !!employee && assignment.employee_id === employee.id;
  const completionEvidenceLocked = assignment?.status === "completed";
  const canMutateEvidence = canMutateCourseEvidence(
    assignment?.employee_id,
    employee?.id,
    assignment?.status,
  );

  const upsertProgress = useUpsertCourseProgress();
  const startAssignment = useStartCourseAssignment();
  const completeAssignment = useCompleteCourseAssignment();
  const { data: existingFeedback } = useGetCourseFeedbackForAssignment(assignmentId);
  const createFeedback = useCreateCourseFeedback();

  const [stepIndex, setStepIndex] = useState(0);
  // Id-keyed like videoStateLoadedForId/lessonToolsLoadedForId below: this component instance
  // survives an in-place assignmentId change (e.g. a global-search jump from one training item
  // straight to another), so a plain boolean would keep the previous assignment's position and
  // skip the new one's resume entirely.
  const [resumedForId, setResumedForId] = useState<string | null>(null);
  const resumed = resumedForId === assignmentId;

  // Per-block video watch state (resume position, no-skip high-water mark, completion).
  // Hydrated once per assignment from course_progress.video_state; the ref mirrors the
  // state so the navigation/visibility checkpoints below can persist the latest values
  // without re-running on every playback tick.
  const [videoState, setVideoState] = useState<Record<string, VideoBlockState>>({});
  const videoStateRef = useRef<Record<string, VideoBlockState>>({});
  const [videoStateLoadedForId, setVideoStateLoadedForId] = useState<string | null>(null);

  // Tracks the furthest lesson the employee has ever reached, so the lesson-stepper pills below can
  // allow jumping back to any already-visited lesson while still blocking a jump ahead of it. Only
  // grows while an assignment is open -- moving stepIndex backward (Previous, or a pill click) never
  // lowers it, so "visited" stays visited even after navigating away from it. The resume effect
  // seeds it to the landing step when an assignment is adopted, so an employee resuming mid-training
  // sees every prior lesson already unlocked -- and re-seeds it from scratch when a different
  // assignment takes over this mounted instance, so one course's unlocks never leak into another.
  const [furthestIndex, setFurthestIndex] = useState(0);
  useEffect(() => {
    setFurthestIndex(f => Math.max(f, stepIndex));
  }, [stepIndex]);

  // Post-completion rating prompt. Newly completed employee training items go to certificates;
  // rating an older completion or any non-employee self-training returns to My Training.
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [showClearLearningToolsConfirm, setShowClearLearningToolsConfirm] = useState(false);
  const [postCompleteDestination, setPostCompleteDestination] = useState<"/me/certificates" | "/me/courses">(
    isEmployeeRole ? "/me/certificates" : "/me/courses",
  );
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [lessonNotes, setLessonNotes] = useState<Record<string, string>>({});
  const [lessonConfidence, setLessonConfidence] = useState<Record<string, LessonConfidence>>({});
  // Tracks which assignmentId's data is currently loaded in lessonNotes/lessonConfidence.
  // Using an id string (rather than a boolean) prevents the save effect from writing stale
  // notes/confidence to a new assignment's storage key: when assignmentId changes, both the
  // load and save effects run in the same render pass. The save effect's closure captures the
  // old lessonToolsLoadedForId value, so the guard `lessonToolsLoadedForId !== assignmentId`
  // blocks the write until the load effect's state updates are committed in the next render.
  const [lessonToolsLoadedForId, setLessonToolsLoadedForId] = useState<string | null>(null);
  const [learningToolsStorageError, setLearningToolsStorageError] = useState<string | null>(null);
  const [lastStudyToolsSavedAt, setLastStudyToolsSavedAt] = useState<string | null>(null);
  const [readingComfort, setReadingComfort] = useState<ReadingComfort>("comfortable");
  // Mirrors lessonNotes/lessonConfidence so the checkpoint upserts below can persist the
  // latest values without re-running on every keystroke (same pattern as videoStateRef).
  const learningToolsRef = useRef<LearningToolsState>({ notes: {}, confidence: {} });

  // Hydrate study aids once per assignment, after the progress row settles: the server
  // copy (course_progress.learning_tools) is the source of truth so notes follow the
  // employee across devices; localStorage is adopted only when the server has nothing --
  // the one-time migration path for notes written before server sync existed (the
  // debounced save below then persists them).
  useEffect(() => {
    const key = lessonStorageKey(assignmentId);
    if (!key || !ownsAssignment || progressLoading || progressError || lessonToolsLoadedForId === assignmentId) return;
    setLearningToolsStorageError(null);
    let local: LearningToolsState = { notes: {}, confidence: {} };
    try {
      // Local reflection state is a learning aid only; malformed browser storage should not block
      // the regulated source-of-truth progress row from loading or saving normally.
      local = parseLearningToolsState(window.localStorage.getItem(key));
    } catch (e) {
      console.warn("Unable to load local training study tools:", (e as Error).message);
      setLearningToolsStorageError("Local notes are unavailable in this browser session.");
    }
    const server = sanitizeLearningToolsState(progress?.learning_tools);
    const adopted = hasLearningToolsEntries(server) ? server : local;
    setLessonNotes(adopted.notes);
    setLessonConfidence(adopted.confidence);
    learningToolsRef.current = adopted;
    setLessonToolsLoadedForId(assignmentId);
    setLastStudyToolsSavedAt(null);
  }, [assignmentId, ownsAssignment, progress?.learning_tools, progressLoading, progressError, lessonToolsLoadedForId]);

  // Keep the ref in step with state; declared before the persistence effects so they
  // always read the current values.
  useEffect(() => {
    learningToolsRef.current = { notes: lessonNotes, confidence: lessonConfidence };
  }, [lessonNotes, lessonConfidence]);

useEffect(() => {
  const key = lessonStorageKey(assignmentId);
  if (!key || !ownsAssignment || lessonToolsLoadedForId !== assignmentId) return;

  const timeoutId = window.setTimeout(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify({ notes: lessonNotes, confidence: lessonConfidence }));
      setLearningToolsStorageError(null);
      setLastStudyToolsSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch (e) {
      console.warn("Unable to save local training study tools:", (e as Error).message);
      setLearningToolsStorageError("Your notes could not be saved locally in this browser session.");
    }
  }, 300);

  return () => window.clearTimeout(timeoutId);
}, [assignmentId, lessonNotes, lessonConfidence, lessonToolsLoadedForId, ownsAssignment]);

  // Hydrate video watch state once per assignment (progress refetches after every
  // checkpoint upsert; re-hydrating from those echoes would clobber newer local ticks).
  useEffect(() => {
    if (!ownsAssignment || videoStateLoadedForId === assignmentId || progressLoading || progressError) return;
    const parsed = sanitizeVideoState(progress?.video_state);
    videoStateRef.current = parsed;
    setVideoState(parsed);
    setVideoStateLoadedForId(assignmentId);
  }, [assignmentId, ownsAssignment, progress?.video_state, progressLoading, progressError, videoStateLoadedForId]);

  const handleVideoStateChange = (blockId: string, next: VideoBlockState) => {
    if (!canMutateEvidence) return;
    videoStateRef.current = { ...videoStateRef.current, [blockId]: next };
    setVideoState(videoStateRef.current);
  };

  // started_at for the checkpoint payload below: adopted from the server row (or cleared) when
  // an assignment is resumed, then kept fresh as checkpoint refetches echo it back.
  const progressStartedAtRef = useRef<string | null>(null);

  // Resume where the employee left off (course_progress.last_block_id), once per assignment,
  // as soon as blocks are loaded. If there's no progress row yet (brand new assignment) or the
  // stored block no longer exists, we simply start at 0. Adopting an assignment re-seeds
  // stepIndex/furthestIndex and the started_at ref so an in-place switch to a different
  // assignment cannot carry the previous one's position or start time into its checkpoints.
  // A failed progress read is never adopted: resuming at 0 over an unknown server row would
  // checkpoint over state the employee actually reached.
  useEffect(() => {
    if (!ownsAssignment || resumed || !blocks || blocks.length === 0 || progressLoading || progressError) return;
    const lastIdx = progress?.last_block_id ? blocks.findIndex(b => b.id === progress.last_block_id) : -1;
    const landingIndex = lastIdx >= 0 ? lastIdx : 0;
    setStepIndex(landingIndex);
    setFurthestIndex(landingIndex);
    progressStartedAtRef.current = progress?.started_at ?? null;
    setResumedForId(assignmentId);
  }, [assignmentId, ownsAssignment, resumed, blocks, progress, progressLoading, progressError]);

  // Single coalesced progress writer: video ticks, notes, step navigation, and tab-hide
  // all funnel through one payload builder so concurrent debounce timers cannot stampede
  // course_progress upserts. Immediate flush on nav / visibility; trailing debounce otherwise.
  useEffect(() => {
    if (progress?.started_at) progressStartedAtRef.current = progress.started_at;
  }, [progress?.started_at]);

  const flushProgressCheckpoint = useCallback((mode: "debounce" | "immediate") => {
    if (!resumed || !assignment || !canMutateEvidence || completeAssignment.isPending || !blocks || blocks.length === 0) {
      return;
    }
    if (videoStateLoadedForId !== assignmentId && lessonToolsLoadedForId !== assignmentId) {
      // Still hydrating both stores — skip until at least one is ready so we do not wipe server state.
      return;
    }
    const block = blocks[stepIndex];
    if (!block) return;
    const startedAt = progressStartedAtRef.current ?? new Date().toISOString();
    progressStartedAtRef.current = startedAt;
    const payload = {
      assignment_id: assignment.id,
      last_block_id: block.id,
      percent_complete: Math.round(((stepIndex + 1) / blocks.length) * 100),
      started_at: startedAt,
      video_state: videoStateRef.current as unknown as Json,
      learning_tools: learningToolsRef.current as unknown as Json,
    };
    const onProgressError = (error: Error) => {
      toast({
        title: "Could not save progress",
        description: error.message,
        variant: "destructive",
      });
    };
    if (mode === "immediate") {
      upsertProgress.mutate(payload, { onError: onProgressError });
      return;
    }
    // debounce path handled by the effect below via timer calling this with immediate
    upsertProgress.mutate(payload, { onError: onProgressError });
  }, [
    resumed, assignment, canMutateEvidence, completeAssignment.isPending, blocks, stepIndex,
    videoStateLoadedForId, lessonToolsLoadedForId, assignmentId, upsertProgress, toast,
  ]);

  // Trailing debounce for high-frequency writers (video ticks + notes).
  useEffect(() => {
    if (!resumed || !assignment || !canMutateEvidence || completeAssignment.isPending || !blocks || blocks.length === 0) return;
    if (videoStateLoadedForId !== assignmentId && lessonToolsLoadedForId !== assignmentId) return;
    const timer = window.setTimeout(() => flushProgressCheckpoint("immediate"), 3_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoState, lessonNotes, lessonConfidence, lessonToolsLoadedForId, videoStateLoadedForId, canMutateEvidence, completeAssignment.isPending]);

  // Immediate checkpoint on step navigation / resume landing.
  useEffect(() => {
    if (!resumed || !assignment || !canMutateEvidence || completeAssignment.isPending || !blocks || blocks.length === 0) return;
    flushProgressCheckpoint("immediate");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumed, stepIndex, assignment?.id, canMutateEvidence, blocks, completeAssignment.isPending]);

  // Wires the previously-dead assigned -> in_progress transition (see ROADMAP.md Tier 3.4).
  useEffect(() => {
    if (canMutateEvidence && assignment?.status === "assigned" && !startAssignment.isPending && !startAssignment.isError) {
      startAssignment.mutate(assignment.id, {
        onError: (error) => toast({
          title: "Could not start this assignment",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.id, assignment?.status, canMutateEvidence, startAssignment.isPending, startAssignment.isError]);

  // Mobile-safe flush when the tab is backgrounded.
  useEffect(() => {
    if (!resumed || !assignment || !canMutateEvidence || completeAssignment.isPending || !blocks || blocks.length === 0) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      flushProgressCheckpoint("immediate");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumed, assignment?.id, canMutateEvidence, blocks, stepIndex, completeAssignment.isPending, flushProgressCheckpoint]);

  const currentBlock: CourseBlock | undefined = blocks?.[stepIndex];
  const lessonCount = blocks?.length ?? 0;
  const completedLessonCount = Math.min(stepIndex, lessonCount);
  const courseMinutes = useMemo(() => (blocks ?? []).reduce((total, block) => total + estimateBlockMinutes(block), 0), [blocks]);
  const currentMinutes = estimateBlockMinutes(currentBlock);
  const nextBlock = blocks?.[stepIndex + 1];
  const textPreview = getTextPreview(currentBlock);
  const currentLessonNote = currentBlock ? lessonNotes[currentBlock.id] ?? "" : "";
  const appliedResponseRequired =
    !completionEvidenceLocked && requiresAppliedResponse(currentBlock);
  const appliedResponseComplete = isAppliedResponseComplete(currentBlock, currentLessonNote);
  const currentConfidence = currentBlock ? lessonConfidence[currentBlock.id] : undefined;
  const readyCount = (blocks ?? []).filter(block => lessonConfidence[block.id] === "ready").length;
  const reviewBlocks = useMemo(
    () => (blocks ?? []).filter(block => {
      const confidence = lessonConfidence[block.id];
      return confidence === "unsure" || confidence === "review";
    }),
    [blocks, lessonConfidence],
  );
  const needsReviewCount = reviewBlocks.length;
  const hasStudyGuideEntries = (blocks ?? []).some(block => !!lessonNotes[block.id]?.trim() || !!lessonConfidence[block.id]);
  const isQuizBlock = currentBlock?.block_type === "quiz";
  const isLastBlock = !!blocks && blocks.length > 0 && stepIndex === blocks.length - 1;

  const { data: currentQuiz } = useGetQuizByBlockId(isQuizBlock ? currentBlock?.id : undefined);

  const attemptsForCurrentQuiz = useMemo(
    () => (quizAttempts ?? []).filter(a => a.quiz_id === currentQuiz?.id),
    [quizAttempts, currentQuiz?.id],
  );
  const currentQuizPassed = attemptsForCurrentQuiz.some(a => a.passed === true);
  const bestScore = attemptsForCurrentQuiz.reduce<number | null>((best, a) => {
    if (a.score_percent === null) return best;
    return best === null ? a.score_percent : Math.max(best, a.score_percent);
  }, null);

  // ---------------------------------------------------------------------
  // Sequencing decision (documented per task): a quiz block gates forward
  // progress. The employee cannot move past the currently-displayed quiz
  // block -- via Next, or via "Mark Training Complete" if it's the last
  // block -- until at least one attempt on that quiz has `passed`.
  // Applied scenario and practice blocks also gate until the learner records
  // a brief job-specific response. Because this check runs against whichever
  // block is currently on screen, and the employee must click through every
  // block in order to reach the end, this transitively requires passing
  // *every* quiz block in the training item before completion is reachable --
  // without having to bulk-resolve every quiz in the training item up front.
  // ---------------------------------------------------------------------
// Video blocks always gate advance for open assignments: a learner cannot skip past an
// unwatched mandated video. The player also clamps forward seeking until watched through.
// Completed assignments stay unlocked for review.
  // The attestation step. There is no client write policy on course_learner_attestations: signing
  // goes through record_course_attestation(), which copies the statement out of the published
  // block, so a signature can never be recorded against text the learner did not see.
  const attestationRequired = requiresAttestation(currentBlock);
  const attestationContent = attestationRequired ? parseAttestationBlock(currentBlock?.body) : null;
  const { data: attestations } = useListCourseAttestations(assignmentId);
  const recordAttestation = useRecordCourseAttestation();
  const currentAttestation = currentBlock
    ? (attestations ?? []).find(row => row.course_block_id === currentBlock.id)
    : undefined;
  const attestationSigned = !!currentAttestation;
  const [attestationChecked, setAttestationChecked] = useState(false);

  useEffect(() => {
    // Ticking the box is a per-step act, so it resets when the learner moves between steps.
    setAttestationChecked(false);
  }, [currentBlock?.id]);

  const handleSignAttestation = () => {
    if (!assignmentId || !currentBlock || !attestationChecked || attestationSigned) return;
    recordAttestation.mutate(
      { assignmentId, blockId: currentBlock.id },
      {
        onSuccess: () => toast({
          title: "Attestation signed",
          description: "Your signature, the date and time, and the exact statement are recorded with your training record.",
        }),
        onError: (e: Error) => toast({ title: "Could not record your attestation", description: e.message, variant: "destructive" }),
      },
    );
  };

  const isVideoBlock = currentBlock?.block_type === "video" && !!currentBlock?.video_url;
  const currentVideoWatched = currentBlock ? !!videoState[currentBlock.id]?.completedAt : false;
  const videoGateBlocksAdvance =
    isVideoBlock && assignment?.status !== "completed" && !currentVideoWatched;
  const canAdvance = canAdvanceCourseStep({
    completionEvidenceLocked,
    isQuizBlock,
    currentQuizPassed,
    videoGateBlocksAdvance,
    appliedResponseRequired,
    appliedResponseComplete,
    attestationRequired,
    attestationSigned,
  });

  const handleLessonNoteChange = (value: string) => {
    if (!currentBlock || !canMutateEvidence) return;
    setLessonNotes(prev => {
      const notes = { ...prev, [currentBlock.id]: value };
      learningToolsRef.current = { ...learningToolsRef.current, notes };
      return notes;
    });
  };

  const handleConfidenceChange = (confidence: LessonConfidence) => {
    if (!currentBlock || !canMutateEvidence) return;
    setLessonConfidence(prev => ({ ...prev, [currentBlock.id]: confidence }));
  };

  const handleMarkReadyAndContinue = () => {
    if (!currentBlock || !blocks || !canMutateEvidence) return;
    setLessonConfidence(prev => ({ ...prev, [currentBlock.id]: "ready" }));
    if (!isLastBlock && canAdvance) {
      setStepIndex(i => Math.min(blocks.length - 1, i + 1));
    }
  };

  const jumpToBlock = (blockId: string) => {
    if (!blocks) return;
    const idx = blocks.findIndex(block => block.id === blockId);
    if (idx >= 0 && idx <= furthestIndex) setStepIndex(idx);
  };

  const handleCopyStudyGuide = async () => {
    if (!blocks || !hasStudyGuideEntries) return;
    const guide = buildStudyGuide(course?.title ?? "Training item", blocks, lessonNotes, lessonConfidence);
    try {
      await navigator.clipboard.writeText(guide);
      toast({ title: "Study guide copied", description: "Your notes and confidence checks are ready to paste elsewhere." });
    } catch (e) {
      toast({ title: "Could not copy study guide", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleClearLocalLearningTools = () => {
    if (!hasStudyGuideEntries || !canMutateEvidence) return;
    const key = lessonStorageKey(assignmentId);
    try {
      if (key) window.localStorage.removeItem(key);
    } catch (e) {
      console.warn("Unable to clear local training study tools:", (e as Error).message);
    }
    setLessonNotes({});
    setLessonConfidence({});
    setLastStudyToolsSavedAt(null);
    setShowClearLearningToolsConfirm(false);
    toast({ title: "Local study tools cleared", description: "Your training progress and quiz attempts were not changed." });
  };

useEffect(() => {
  const blockCount = blocks?.length ?? 0;
  if (!shouldEnableCourseShortcuts({
    ownsAssignment,
    hasBlocks: blockCount > 0,
    showRatingPrompt,
    showClearLearningToolsConfirm,
  })) return;
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditableShortcutTarget(event.target)) return;
    if (event.key === "ArrowLeft" && stepIndex > 0) {
      event.preventDefault();
      setStepIndex(i => Math.max(0, i - 1));
    } else if (event.key === "ArrowRight" && !isLastBlock && canAdvance) {
      event.preventDefault();
      setStepIndex(i => Math.min(blockCount - 1, i + 1));
    } else if (event.key.toLowerCase() === "r" && currentBlock && canMutateEvidence) {
      event.preventDefault();
      setLessonConfidence(prev => ({ ...prev, [currentBlock.id]: "ready" }));
      if (!isLastBlock && canAdvance) {
        setStepIndex(i => Math.min(blockCount - 1, i + 1));
      }
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [blocks, canAdvance, canMutateEvidence, currentBlock, isLastBlock, ownsAssignment, showClearLearningToolsConfirm, showRatingPrompt, stepIndex]);

  const handleComplete = () => {
    if (!assignment || !canMutateEvidence) return;
    completeAssignment.mutate(assignment.id, {
      onSuccess: () => {
        // Certificate issuance is part of the same database transaction. A successful response
        // guarantees there is exactly one certificate, even after retries or concurrent clicks.
        toast({ title: "Training completed", description: "Certificate issued -- nice work!" });
        setPostCompleteDestination(isEmployeeRole ? "/me/certificates" : "/me/courses");
        setShowRatingPrompt(true);
      },
      onError: (e: Error) => toast({ title: "Failed to complete training", description: e.message, variant: "destructive" }),
    });
  };

  const handleSkipRating = () => {
    setShowRatingPrompt(false);
    setLocation(postCompleteDestination);
  };

  const handleSubmitRating = () => {
    if (!assignment || !employee || !ownsAssignment || ratingValue === 0) return;
    createFeedback.mutate(
      {
        course_assignment_id: assignment.id,
        course_id: assignment.course_id,
        employee_id: assignment.employee_id,
        // Courses can be system-catalog (organization_id null); course_feedback is always
        // org-scoped, so this stamps the employee's own org rather than the course's.
        organization_id: employee.organization_id,
        rating: ratingValue,
        comment: ratingComment.trim() || null,
      },
      {
        onSuccess: () => {
          setShowRatingPrompt(false);
          setLocation(postCompleteDestination);
        },
        onError: (e: Error) => {
          toast({ title: "Failed to submit rating", description: e.message, variant: "destructive" });
          setShowRatingPrompt(false);
          setLocation(postCompleteDestination);
        },
      },
    );
  };

  if (employeeLoading || assignmentLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="h-4 w-full max-w-md bg-muted animate-pulse rounded" />
        <div className="h-72 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  // A failed fetch must not be presented as a missing assignment.
  if (assignmentError) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}><ArrowLeft className="mr-2 h-4 w-4" /> {backLabel}</Link>
        </Button>
        <QueryError what="this training assignment" error={assignmentErrorDetail} onRetry={() => void refetchAssignment()} />
      </div>
    );
  }

  if (!employee || !assignment || assignment.employee_id !== employee.id) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Training assignment not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={backHref}><ArrowLeft className="mr-2 h-4 w-4" /> {backLabel}</Link>
        </Button>
      </div>
    );
  }

  // Same rule for the progress row: a failed read is indistinguishable from a brand-new
  // assignment, and checkpointing over it would overwrite the server-side resume state, video
  // watch evidence, and notes. The hydration and resume effects above stay parked on error,
  // so nothing is written until a retry succeeds.
  if (progressError) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}><ArrowLeft className="mr-2 h-4 w-4" /> {backLabel}</Link>
        </Button>
        <QueryError what="your training progress" error={progressErrorDetail} onRetry={() => void refetchProgress()} />
      </div>
    );
  }

  const alreadyCompleted = assignment.status === "completed";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}><ArrowLeft className="mr-2 h-4 w-4" /> {backLabel}</Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{course?.title ?? "Training item"}</h1>
        <div className="flex items-center gap-2 mt-1">
          {alreadyCompleted ? (
            <Badge>Completed</Badge>
          ) : (
            <AssignmentStatusBadge status={assignment.status} />
          )}
          {assignment.due_date && !alreadyCompleted && (() => {
            const dueDistance = formatDueDistance(assignment.due_date);
            const daysLeft = facilityDaysUntil(assignment.due_date);
            const dueTone =
              daysLeft !== null && daysLeft < 0
                ? "text-destructive font-medium"
                : daysLeft !== null && daysLeft <= 7
                  ? "text-amber-600 font-medium"
                  : "text-muted-foreground";
            return (
              <span className={`text-sm ${dueTone}`}>
                Due {formatDateForDisplay(assignment.due_date)}
                {dueDistance ? ` · ${dueDistance}` : ""}
              </span>
            );
          })()}
          {assignment.due_date && alreadyCompleted && (
            <span className="text-sm text-muted-foreground">
              Due {formatDateForDisplay(assignment.due_date)}
            </span>
          )}
        </div>
      </div>

      {blocksLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}
        </div>
      ) : blocksError ? (
        <QueryError what="the course content" error={blocksErrorDetail} onRetry={() => void refetchBlocks()} />
      ) : !blocks || blocks.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground text-center">
              This training item doesn't have any content yet. Check back later.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Lesson {stepIndex + 1} of {blocks.length}</span>
              <span>{Math.round(((stepIndex + 1) / blocks.length) * 100)}%</span>
            </div>
            <Progress value={((stepIndex + 1) / blocks.length) * 100} />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2 text-primary">
                    <Target className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Focus for this step</p>
                    <p className="text-sm text-muted-foreground">
                      {isQuizBlock
                        ? "Prove you can apply the material before moving on. Review the previous lesson if your score is not yet passing."
                        : textPreview ?? "Read or watch carefully, then use Next when you are ready to continue."}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Learning pace
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  About {currentMinutes} min for this step
                  {courseMinutes > 0 && ` · ${courseMinutes} min total`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {completedLessonCount} completed · {Math.max(lessonCount - stepIndex - 1, 0)} after this
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {readyCount} marked ready · {needsReviewCount} to review
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={handleCopyStudyGuide}
                  disabled={!hasStudyGuideEntries}
                >
                  <Copy className="mr-2 h-3.5 w-3.5" /> Copy study guide
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full text-muted-foreground"
                  onClick={() => setShowClearLearningToolsConfirm(true)}
                  disabled={!hasStudyGuideEntries || completionEvidenceLocked}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Clear local notes
                </Button>
              </CardContent>
            </Card>
          </div>

          {blocks.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Training map: revisit completed steps, track what is locked, and see what comes next.</p>
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Lesson navigation">
                {blocks.map((b, i) => {
                  const isCurrent = i === stepIndex;
                  const isVisited = i <= furthestIndex;
                  const Icon = BLOCK_ICON[b.block_type ?? "text"] ?? FileText;
                  const confidence = lessonConfidence[b.id];
                  return (
                    <button
                      key={b.id}
                      type="button"
                      role="tab"
                      aria-selected={isCurrent}
                      aria-current={isCurrent ? "step" : undefined}
                      aria-label={`Lesson ${i + 1}${b.title ? `: ${b.title}` : ""}${isCurrent ? " (current)" : !isVisited ? " (not yet visited)" : ""}`}
                      title={b.title ?? `Lesson ${i + 1}`}
                      disabled={!isVisited}
                      onClick={() => setStepIndex(i)}
                      className={`min-h-9 max-w-full px-2.5 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1.5 ${
                        isCurrent
                          ? "bg-primary text-primary-foreground border-primary"
                          : isVisited
                            ? "bg-secondary text-secondary-foreground border-transparent hover:bg-secondary/70 cursor-pointer"
                            : "bg-muted text-muted-foreground/50 border-transparent cursor-not-allowed"
                      }`}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span>{i + 1}</span>
                      <span className="hidden sm:inline truncate max-w-28">{b.title ?? getBlockLabel(b.block_type)}</span>
{confidence && (
  <span className="hidden md:inline text-[10px] opacity-80">
    · {CONFIDENCE_LABEL[confidence]}
  </span>
)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {reviewBlocks.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-warning/10 p-2 text-warning">
                    <RotateCcw className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <p className="text-sm font-medium">Personal review queue</p>
                      <p className="text-xs text-muted-foreground">
                        These are the lessons you marked for extra practice. Revisit them before the final completion step.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {reviewBlocks.slice(0, 4).map(block => {
                        const blockIndex = blocks.findIndex(b => b.id === block.id);
                        const locked = blockIndex > furthestIndex;
                        return (
                          <Button
                            key={block.id}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={locked}
                            onClick={() => jumpToBlock(block.id)}
                          >
                            {blockIndex + 1}. {block.title ?? getBlockLabel(block.block_type)}
                          </Button>
                        );
                      })}
                      {reviewBlocks.length > 4 && (
                        <Badge variant="secondary">+{reviewBlocks.length - 4} more</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{getLearningStepLabel(currentBlock)}</Badge>
                  <Badge variant="secondary">{currentMinutes} min</Badge>
                  {isQuizBlock && currentQuizPassed && <Badge className="bg-success text-success-foreground">Passed</Badge>}
                </div>
                <CardTitle className="flex items-center gap-2">
                  {(() => {
                    const Icon = BLOCK_ICON[currentBlock?.block_type ?? "text"] ?? FileText;
                    return <Icon className="h-5 w-5" />;
                  })()}
                  {currentBlock?.title ?? "Untitled lesson"}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentBlock?.block_type === "text" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Reading comfort</p>
                    <div className="flex flex-wrap gap-1">
                      {(Object.keys(READING_COMFORT_LABEL) as ReadingComfort[]).map((comfort) => (
                        <Button
                          key={comfort}
                          type="button"
                          variant={readingComfort === comfort ? "default" : "outline"}
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setReadingComfort(comfort)}
                        >
                          {READING_COMFORT_LABEL[comfort]}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className={`${READING_COMFORT_CLASS[readingComfort]} whitespace-pre-wrap`}>
                      {(currentBlock.body as { content?: string } | null)?.content ?? "No content entered for this lesson."}
                    </p>
                  </div>
                </div>
              )}

              {currentBlock?.block_type === "video" && (
                currentBlock.video_url ? (
                  <CourseVideoPlayer
                    key={currentBlock.id}
                    src={currentBlock.video_url}
                    state={videoState[currentBlock.id]}
                    gated={assignment?.status !== "completed"}
                    onChange={(next) => handleVideoStateChange(currentBlock.id, next)}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No video available for this lesson.</p>
                )
              )}

              {currentBlock?.block_type === "pdf" && (
                <DocumentBlockLink documentId={currentBlock.document_id} />
              )}

              {currentBlock?.block_type === "scorm" && (
                <StandardsRuntimePlayer
                  assignmentId={assignmentId!}
                  courseId={assignment?.course_id ?? course?.id ?? ""}
                  courseVersionId={assignment?.course_version_id ?? undefined}
                  blockId={currentBlock.id}
                  fallback={<DocumentBlockLink documentId={currentBlock.document_id} />}
                />
              )}

              {currentBlock?.block_type === "quiz" && (
                <div className="space-y-3">
                  <div className="rounded-lg border bg-info/10 p-3 text-sm text-info-foreground">
                    <p className="font-medium">Passing this knowledge check unlocks the next lesson.</p>
                    <p className="mt-1 text-muted-foreground">
                      If you miss the passing score, revisit earlier lessons using the training map and try again.
                    </p>
                  </div>
                  {currentQuizPassed && (
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <CheckCircle2 className="h-4 w-4" /> Passed
                      {bestScore !== null && ` -- best score ${bestScore}%`}
                    </div>
                  )}
                  {!currentQuizPassed && attemptsForCurrentQuiz.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {attemptsForCurrentQuiz.length} attempt{attemptsForCurrentQuiz.length === 1 ? "" : "s"} so far
                      {bestScore !== null && ` -- best score ${bestScore}%`}. Try again to pass.
                    </p>
                  )}
                  {currentQuiz && completionEvidenceLocked ? (
                    <p className="text-sm text-muted-foreground">
                      Assessment documentation is locked after course completion.
                    </p>
                  ) : currentQuiz ? (
                    <Button asChild>
                      <Link href={`/me/courses/${assignmentId}/quiz/${currentQuiz.id}`}>
                        <ListChecks className="mr-2 h-4 w-4" /> Take Quiz
                      </Link>
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No quiz has been configured for this lesson yet.</p>
                  )}
                </div>
              )}

              {currentBlock?.block_type === "attestation" && (
                <div className="space-y-4">
                  {attestationContent?.intro && (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{attestationContent.intro}</p>
                  )}
                  {attestationContent ? (
                    <>
                      <blockquote className="rounded-lg border-l-4 border-primary bg-muted/30 p-4 text-sm leading-6">
                        {attestationContent.statement}
                      </blockquote>
                      {attestationSigned ? (
                        <div className="flex items-start gap-2 rounded-lg border bg-success/10 p-3">
                          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                          <div className="text-sm">
                            <p className="font-medium text-foreground">Attestation signed</p>
                            <p className="text-muted-foreground">
                              Signed {formatDateForDisplay(currentAttestation!.attested_at)} &middot; statement version{" "}
                              {currentAttestation!.attestation_version}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <label className="flex cursor-pointer items-start gap-2.5">
                            <Checkbox
                              checked={attestationChecked}
                              onCheckedChange={(checked) => setAttestationChecked(checked === true)}
                              disabled={completionEvidenceLocked}
                              aria-describedby={`${__fieldIds}-attestation-help`}
                            />
                            <span className="text-sm">
                              I have read the statement above and I attest to it.
                            </span>
                          </label>
                          <p id={`${__fieldIds}-attestation-help`} className="text-xs text-muted-foreground">
                            Your name, the date and time, this course version, and the exact statement text are
                            recorded with your training record. Your certificate is issued as soon as you sign.
                          </p>
                          <Button
                            onClick={handleSignAttestation}
                            disabled={!attestationChecked || recordAttestation.isPending || completionEvidenceLocked}
                          >
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            {recordAttestation.isPending ? "Signing..." : "Sign attestation"}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      This attestation step has no published statement yet. Contact your administrator.
                    </p>
                  )}
                </div>
              )}

              {currentBlock && currentBlock.block_type !== "attestation" && (
                <div className="rounded-lg border bg-background p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-secondary p-2 text-secondary-foreground">
                      <Lightbulb className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <p className="text-sm font-medium">
                          {appliedResponseRequired ? "My applied response" : "My takeaway"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {appliedResponseRequired
                            ? `Describe what you would do in this situation or practice on shift. Enter at least ${MIN_APPLIED_RESPONSE_CHARACTERS} characters to continue.`
                            : "Jot down what you would do differently on the job because of this lesson."}
                          {" "}Do not include resident or patient names or other identifiers. Responses save to your training record so you can pick up on any device, and your trainer can review them with you.
                        </p>
                      </div>
                      <Textarea
                        value={currentLessonNote}
                        onChange={(e) => handleLessonNoteChange(e.target.value)}
                        placeholder={appliedResponseRequired
                          ? "Describe the steps you would take and why..."
                          : "Example: I should document the incident time before calling the supervisor..."}
                        rows={3}
                        readOnly={completionEvidenceLocked}
                        aria-invalid={appliedResponseRequired && !appliedResponseComplete}
                      />
                      {appliedResponseRequired && (
                        <p className={`text-xs ${appliedResponseComplete ? "text-success" : "text-warning"}`}>
                          {currentLessonNote.trim().length}/{MIN_APPLIED_RESPONSE_CHARACTERS} required characters
                        </p>
                      )}
                      <p className={`text-xs ${learningToolsStorageError ? "text-destructive" : "text-muted-foreground"}`}>
                        {completionEvidenceLocked
                          ? "Completed responses and confidence checks are read-only documentation."
                          : learningToolsStorageError
                          ? learningToolsStorageError
                          : lastStudyToolsSavedAt
                            ? `Saved at ${lastStudyToolsSavedAt}.`
                            : "Notes and confidence checks save to your training record."}
                      </p>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                          Confidence check
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(Object.keys(CONFIDENCE_LABEL) as LessonConfidence[]).map((confidence) => (
                            <Button
                              key={confidence}
                              type="button"
                              variant={currentConfidence === confidence ? "default" : "outline"}
                              size="sm"
                              onClick={() => handleConfidenceChange(confidence)}
                              disabled={completionEvidenceLocked}
                            >
                              {CONFIDENCE_LABEL[confidence]}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!isLastBlock && nextBlock && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium">Up next</p>
                  <p className="text-muted-foreground">
                    {getLearningStepLabel(nextBlock)}: {nextBlock.title ?? "Untitled lesson"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setStepIndex(i => Math.max(0, i - 1))}
              disabled={stepIndex === 0}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Previous
            </Button>

            {isLastBlock ? (
              alreadyCompleted ? (
                <div className="flex items-center gap-3">
                  <Badge className="px-3 py-1.5">
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Training Completed
                  </Badge>
                  {!existingFeedback && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => { setPostCompleteDestination("/me/courses"); setShowRatingPrompt(true); }}
                    >
                      Rate this training
                    </Button>
                  )}
                </div>
              ) : (
                <Button onClick={handleComplete} disabled={!canAdvance || completeAssignment.isPending}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {completeAssignment.isPending ? "Completing..." : "Mark Training Complete"}
                </Button>
              )
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={handleMarkReadyAndContinue}
                  disabled={!canAdvance || completionEvidenceLocked}
                >
                  <ClipboardCheck className="mr-2 h-4 w-4" /> Mark ready & next
                </Button>
                <Button
                  onClick={() => setStepIndex(i => Math.min(blocks.length - 1, i + 1))}
                  disabled={!canAdvance}
                >
                  Next <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          {!canAdvance && (
            <p className="text-xs text-muted-foreground text-right">
              {videoGateBlocksAdvance
                ? "Watch the video above to continue."
                : appliedResponseRequired && !appliedResponseComplete
                  ? `Enter an applied response of at least ${MIN_APPLIED_RESPONSE_CHARACTERS} characters to continue.`
                  : attestationRequired && !attestationSigned
                    ? "Read and sign the attestation above to finish this training."
                    : "Pass the quiz above to continue."}
            </p>
          )}
          <p className="text-xs text-muted-foreground text-center">
            Keyboard shortcuts: ← previous · → next · R mark ready
          </p>
          {isLastBlock && !alreadyCompleted && needsReviewCount > 0 && (
            <p className="text-xs text-warning text-right">
              You can complete the training item, but {needsReviewCount} lesson{needsReviewCount === 1 ? "" : "s"} are still marked for review.
            </p>
          )}
        </>
      )}

      <Dialog open={showRatingPrompt} onOpenChange={(o) => { if (!o) handleSkipRating(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Rate this training</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              How helpful was "{course?.title ?? "this training item"}"? Your feedback helps trainers improve it.
            </p>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRatingValue(n)}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  className="p-0.5"
                >
                  <Star className={`h-7 w-7 ${n <= ratingValue ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                </button>
              ))}
            </div>
            <Textarea
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              placeholder="Anything you'd add? (optional)"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleSkipRating}>Skip</Button>
            <Button onClick={handleSubmitRating} disabled={ratingValue === 0 || createFeedback.isPending}>
              {createFeedback.isPending ? "Submitting..." : "Submit Rating"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showClearLearningToolsConfirm} onOpenChange={setShowClearLearningToolsConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear local study tools?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes your notes and confidence checks for this training item from this device. Your training progress and quiz attempts will not change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep notes</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearLocalLearningTools}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear local notes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
