import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { sanitizeVideoState, type VideoBlockState } from "@/lib/videoWatchState";
import { CourseVideoPlayer } from "@/components/CourseVideoPlayer";
import { useFeatureReleaseActive } from "@/hooks/useFeatureRelease";
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
  sanitizeLearningToolsState,
  shouldEnableCourseShortcuts,
  type LearningToolsState,
  type LessonConfidence,
} from "@/lib/courseLearningTools";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import {
  ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, Clock, Copy, Download, FileText, Lightbulb, ListChecks, RotateCcw, Trash2, Video, BookOpen, Star, Target,
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
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Every role can reach this page now (App.tsx's ANY_ROLE), but /me/trainings and
  // /me/certificates stay employee-only routes -- routing anyone else there would just bounce
  // them straight back out via ProtectedRoute. /me/courses is the one training-assignment destination every
  // role can actually land on.
  const isEmployeeRole = user?.role === "employee";
  const backHref = isEmployeeRole ? "/me/trainings" : "/me/courses";
  const backLabel = isEmployeeRole ? "Back to My Training Records" : "Back to My Training";

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const { data: assignment, isLoading: assignmentLoading } = useGetCourseAssignment(assignmentId);
  const { data: course } = useGetCourse(assignment?.course_id);
  const { data: blocks, isLoading: blocksLoading } = useListCourseBlocks(assignment?.course_version_id);
  const { data: progress, isLoading: progressLoading } = useGetCourseProgress(assignmentId);
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
  const [resumed, setResumed] = useState(false);

  // Per-block video watch state (resume position, no-skip high-water mark, completion).
  // Hydrated once per assignment from course_progress.video_state; the ref mirrors the
  // state so the navigation/visibility checkpoints below can persist the latest values
  // without re-running on every playback tick.
  const { isActive: watchGateReleased } = useFeatureReleaseActive("learning.video_watch_gate");
  const [videoState, setVideoState] = useState<Record<string, VideoBlockState>>({});
  const videoStateRef = useRef<Record<string, VideoBlockState>>({});
  const [videoStateLoadedForId, setVideoStateLoadedForId] = useState<string | null>(null);

  // Tracks the furthest lesson the employee has ever reached, so the lesson-stepper pills below can
  // allow jumping back to any already-visited lesson while still blocking a jump ahead of it. Starts
  // at 0 and only grows -- moving stepIndex backward (Previous, or a pill click) never lowers it, so
  // "visited" stays visited even after navigating away from it. Also picks up the resumed starting
  // step once progress loads (the effect below re-fires whenever stepIndex changes, including that
  // one-time jump), so an employee resuming mid-training sees every prior lesson already unlocked.
  const [furthestIndex, setFurthestIndex] = useState(0);
  useEffect(() => {
    setFurthestIndex(f => Math.max(f, stepIndex));
  }, [stepIndex]);

  // Post-completion rating prompt state. postCompleteDestination tracks where to navigate once
  // the employee submits or skips the rating: newly completed employee training items go to the issued
  // certificate, someone rating an older completion can still return to trainings, and non-
  // non-employee self-training users return to the role-safe training list.
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [showClearLearningToolsConfirm, setShowClearLearningToolsConfirm] = useState(false);
  const [postCompleteDestination, setPostCompleteDestination] = useState<"/me/certificates" | "/me/trainings" | "/me/courses">(
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
    if (!key || !ownsAssignment || progressLoading || lessonToolsLoadedForId === assignmentId) return;
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
  }, [assignmentId, ownsAssignment, progress?.learning_tools, progressLoading, lessonToolsLoadedForId]);

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
    if (!ownsAssignment || videoStateLoadedForId === assignmentId || progressLoading) return;
    const parsed = sanitizeVideoState(progress?.video_state);
    videoStateRef.current = parsed;
    setVideoState(parsed);
    setVideoStateLoadedForId(assignmentId);
  }, [assignmentId, ownsAssignment, progress?.video_state, progressLoading, videoStateLoadedForId]);

  const handleVideoStateChange = (blockId: string, next: VideoBlockState) => {
    if (!canMutateEvidence) return;
    videoStateRef.current = { ...videoStateRef.current, [blockId]: next };
    setVideoState(videoStateRef.current);
  };

  // Debounced persistence of playback ticks: the player reports every few seconds while
  // playing and on pause/completion; this trails those reports so an interrupted session
  // loses at most a few seconds of position. Block navigation and tab-backgrounding
  // still checkpoint immediately via the effects below.
  useEffect(() => {
    if (!resumed || !assignment || !canMutateEvidence || completeAssignment.isPending || !blocks || blocks.length === 0) return;
    if (videoStateLoadedForId !== assignmentId) return;
    const block = blocks[stepIndex];
    if (!block || Object.keys(videoState).length === 0) return;
    const timer = window.setTimeout(() => {
      upsertProgress.mutate({
        assignment_id: assignment.id,
        last_block_id: block.id,
        percent_complete: Math.round(((stepIndex + 1) / blocks.length) * 100),
        started_at: progress?.started_at ?? new Date().toISOString(),
        video_state: videoStateRef.current as unknown as Json,
        learning_tools: learningToolsRef.current as unknown as Json,
      });
    }, 3_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoState, canMutateEvidence, completeAssignment.isPending]);

  // Same trailing debounce for study aids: notes change on every keystroke, so the
  // server write waits for a pause; block navigation and tab-backgrounding still
  // checkpoint immediately. Also fires once right after hydration, which is what
  // persists device-only notes adopted from localStorage.
  useEffect(() => {
    if (!resumed || !assignment || !canMutateEvidence || completeAssignment.isPending || !blocks || blocks.length === 0) return;
    if (lessonToolsLoadedForId !== assignmentId) return;
    const block = blocks[stepIndex];
    if (!block) return;
    const timer = window.setTimeout(() => {
      upsertProgress.mutate({
        assignment_id: assignment.id,
        last_block_id: block.id,
        percent_complete: Math.round(((stepIndex + 1) / blocks.length) * 100),
        started_at: progress?.started_at ?? new Date().toISOString(),
        video_state: videoStateRef.current as unknown as Json,
        learning_tools: learningToolsRef.current as unknown as Json,
      });
    }, 3_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonNotes, lessonConfidence, lessonToolsLoadedForId, canMutateEvidence, completeAssignment.isPending]);

  // Resume where the employee left off (course_progress.last_block_id), once,
  // as soon as blocks are loaded. If there's no progress row yet (brand new
  // assignment) or the stored block no longer exists, we simply start at 0.
  useEffect(() => {
    if (!ownsAssignment || resumed || !blocks || blocks.length === 0 || progressLoading) return;
    if (progress?.last_block_id) {
      const idx = blocks.findIndex(b => b.id === progress.last_block_id);
      if (idx >= 0) setStepIndex(idx);
    }
    setResumed(true);
  }, [ownsAssignment, resumed, blocks, progress, progressLoading]);

  // Persist progress on navigation only (not on every render): this fires
  // once the resumed starting step lands, and again each time stepIndex
  // changes via Previous/Next. started_at is stamped once (reusing the
  // already-loaded progress row's value if it has one) and never overwritten
  // afterward -- complete_course_assignment() uses the gap between it and
  // the completion request as a minimum-seat-time completion-integrity check.
  useEffect(() => {
    if (!resumed || !assignment || !canMutateEvidence || completeAssignment.isPending || !blocks || blocks.length === 0) return;
    const block = blocks[stepIndex];
    if (!block) return;
    const percentComplete = Math.round(((stepIndex + 1) / blocks.length) * 100);
    upsertProgress.mutate({
      assignment_id: assignment.id,
      last_block_id: block.id,
      percent_complete: percentComplete,
      started_at: progress?.started_at ?? new Date().toISOString(),
      video_state: videoStateRef.current as unknown as Json,
      learning_tools: learningToolsRef.current as unknown as Json,
    });
    // Only re-run when the resolved step (or the assignment/blocks it's
    // scoped to) actually changes -- upsertProgress.mutate is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumed, stepIndex, assignment?.id, canMutateEvidence, blocks, completeAssignment.isPending]);

  // Wires the previously-dead assigned -> in_progress transition (see ROADMAP.md Tier 3.4):
  // fires once the assignment loads if it's still in its just-assigned state. The RPC itself is
  // idempotent (only flips status when it's still 'assigned'), so a duplicate call from a fast
  // re-render is harmless -- no extra guard needed beyond the status check itself.
  useEffect(() => {
    if (canMutateEvidence && assignment?.status === "assigned" && !startAssignment.isPending) {
      startAssignment.mutate(assignment.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.id, assignment?.status, canMutateEvidence]);

  // Reliable progress checkpointing on mobile (ROADMAP.md Tier 3.4): the stepIndex-triggered save
  // above only fires on Previous/Next, so backgrounding the tab mid-block (locking the phone,
  // switching apps) mid-lesson would otherwise lose that lesson's progress until the employee
  // navigates again. `visibilitychange` fires reliably when a mobile browser is backgrounded,
  // unlike `beforeunload`, which mobile Safari/Chrome do not reliably fire.
  useEffect(() => {
    if (!resumed || !assignment || !canMutateEvidence || completeAssignment.isPending || !blocks || blocks.length === 0) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      const block = blocks[stepIndex];
      if (!block) return;
      upsertProgress.mutate({
        assignment_id: assignment.id,
        last_block_id: block.id,
        percent_complete: Math.round(((stepIndex + 1) / blocks.length) * 100),
        started_at: progress?.started_at ?? new Date().toISOString(),
        video_state: videoStateRef.current as unknown as Json,
        learning_tools: learningToolsRef.current as unknown as Json,
      });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumed, assignment?.id, canMutateEvidence, blocks, stepIndex, completeAssignment.isPending]);

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
  // Video blocks gate the same way when the org has released the watch gate:
  // the employee can't move past an unwatched video. Completed assignments are
  // never re-locked (review mode), and videos finished before the flag was
  // enabled already carry completedAt from the resume tracking.
  const isVideoBlock = currentBlock?.block_type === "video" && !!currentBlock?.video_url;
  const currentVideoWatched = currentBlock ? !!videoState[currentBlock.id]?.completedAt : false;
  const videoGateBlocksAdvance =
    watchGateReleased && isVideoBlock && assignment?.status !== "completed" && !currentVideoWatched;
  const canAdvance = canAdvanceCourseStep({
    completionEvidenceLocked,
    isQuizBlock,
    currentQuizPassed,
    videoGateBlocksAdvance,
    appliedResponseRequired,
    appliedResponseComplete,
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
          {assignment.due_date && (
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
                    gated={watchGateReleased && assignment?.status !== "completed"}
                    onChange={(next) => handleVideoStateChange(currentBlock.id, next)}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No video available for this lesson.</p>
                )
              )}

              {(currentBlock?.block_type === "pdf" || currentBlock?.block_type === "scorm") && (
                <DocumentBlockLink documentId={currentBlock.document_id} />
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
                      Assessment evidence is locked after course completion.
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

              {currentBlock && (
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
                          ? "Completed responses and confidence checks are read-only evidence."
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
                      onClick={() => { setPostCompleteDestination("/me/trainings"); setShowRatingPrompt(true); }}
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
