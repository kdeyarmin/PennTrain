import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import {
  useGetCourseAssignment,
  useGetCourseProgress,
  useUpsertCourseProgress,
  useCompleteCourseAssignment,
} from "@/hooks/useCourseAssignments";
import { useGetCourse, useListCourseBlocks, type CourseBlock } from "@/hooks/useCourses";
import { useGetQuizByBlockId, useListQuizAttempts } from "@/hooks/useQuizzes";
import { useDocumentSignedUrl } from "@/hooks/useDocuments";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Download, FileText, ListChecks, Video, BookOpen,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// useDocuments.ts (owned by the hooks agent) exposes list/upload/signed-url/
// delete for `training_documents`, but no single-row get-by-id read. This
// page needs to resolve a course_blocks.document_id to its row so it can
// hand that row to the existing useDocumentSignedUrl mutation -- reused
// as-is per the established Documents.tsx pattern, not reinvented. Rather
// than extend that hook file out of scope, this is one small, clearly
// scoped read that mirrors its conventions and keys its cache under the
// same ["documents", id] shape a useGetDocument(id) would use.
// ---------------------------------------------------------------------------
function useGetDocument(id: string | undefined) {
  return useQuery({
    queryKey: ["documents", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_documents").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

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
      window.open(url, "_blank");
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

export default function TakeCourse() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const { data: assignment, isLoading: assignmentLoading } = useGetCourseAssignment(assignmentId);
  const { data: course } = useGetCourse(assignment?.course_id);
  const { data: blocks, isLoading: blocksLoading } = useListCourseBlocks(assignment?.course_version_id);
  const { data: progress } = useGetCourseProgress(assignmentId);
  const { data: quizAttempts } = useListQuizAttempts({ assignmentId });

  const upsertProgress = useUpsertCourseProgress();
  const completeAssignment = useCompleteCourseAssignment();

  const [stepIndex, setStepIndex] = useState(0);
  const [resumed, setResumed] = useState(false);

  // Resume where the learner left off (course_progress.last_block_id), once,
  // as soon as blocks are loaded. If there's no progress row yet (brand new
  // assignment) or the stored block no longer exists, we simply start at 0.
  useEffect(() => {
    if (resumed || !blocks || blocks.length === 0) return;
    if (progress?.last_block_id) {
      const idx = blocks.findIndex(b => b.id === progress.last_block_id);
      if (idx >= 0) setStepIndex(idx);
    }
    setResumed(true);
  }, [resumed, blocks, progress]);

  // Persist progress on navigation only (not on every render): this fires
  // once the resumed starting step lands, and again each time stepIndex
  // changes via Previous/Next.
  useEffect(() => {
    if (!resumed || !assignment || !blocks || blocks.length === 0) return;
    const block = blocks[stepIndex];
    if (!block) return;
    const percentComplete = Math.round(((stepIndex + 1) / blocks.length) * 100);
    upsertProgress.mutate({
      assignment_id: assignment.id,
      last_block_id: block.id,
      percent_complete: percentComplete,
    });
    // Only re-run when the resolved step (or the assignment/blocks it's
    // scoped to) actually changes -- upsertProgress.mutate is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumed, stepIndex, assignment?.id, blocks]);

  const currentBlock: CourseBlock | undefined = blocks?.[stepIndex];
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
  // progress. The learner cannot move past the currently-displayed quiz
  // block -- via Next, or via "Mark Course Complete" if it's the last
  // block -- until at least one attempt on that quiz has `passed`.
  // Non-quiz blocks never gate. Because this check runs against whichever
  // block is currently on screen, and the learner must click through every
  // block in order to reach the end, this transitively requires passing
  // *every* quiz block in the course before completion is reachable --
  // without having to bulk-resolve every quiz in the course up front.
  // ---------------------------------------------------------------------
  const canAdvance = !isQuizBlock || currentQuizPassed;

  const handleComplete = () => {
    if (!assignment) return;
    completeAssignment.mutate(assignment.id, {
      onSuccess: () => {
        toast({ title: "Course completed", description: "Nice work -- this course is now marked complete." });
        setLocation("/me/trainings");
      },
      onError: (e: Error) => toast({ title: "Failed to complete course", description: e.message, variant: "destructive" }),
    });
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
        <p className="text-muted-foreground">Course assignment not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/me/trainings"><ArrowLeft className="mr-2 h-4 w-4" /> Back to My Trainings</Link>
        </Button>
      </div>
    );
  }

  const alreadyCompleted = assignment.status === "completed";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/me/trainings"><ArrowLeft className="mr-2 h-4 w-4" /> Back to My Trainings</Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{course?.title ?? "Course"}</h1>
        <div className="flex items-center gap-2 mt-1">
          {alreadyCompleted ? (
            <Badge>Completed</Badge>
          ) : (
            <Badge variant="secondary">{assignment.status}</Badge>
          )}
          {assignment.due_date && (
            <span className="text-sm text-muted-foreground">
              Due {new Date(assignment.due_date).toLocaleDateString()}
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
              This course doesn't have any content yet. Check back later.
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {(() => {
                  const Icon = BLOCK_ICON[currentBlock?.block_type ?? "text"] ?? FileText;
                  return <Icon className="h-5 w-5" />;
                })()}
                {currentBlock?.title ?? "Untitled lesson"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentBlock?.block_type === "text" && (
                <p className="text-sm whitespace-pre-wrap">
                  {(currentBlock.body as { content?: string } | null)?.content ?? "No content entered for this lesson."}
                </p>
              )}

              {currentBlock?.block_type === "video" && (
                currentBlock.video_url ? (
                  <video controls className="w-full rounded-lg border" src={currentBlock.video_url}>
                    Your browser does not support embedded video.
                  </video>
                ) : (
                  <p className="text-sm text-muted-foreground">No video available for this lesson.</p>
                )
              )}

              {(currentBlock?.block_type === "pdf" || currentBlock?.block_type === "scorm") && (
                <DocumentBlockLink documentId={currentBlock.document_id} />
              )}

              {currentBlock?.block_type === "quiz" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    This lesson has a quiz you must pass to continue.
                  </p>
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
                  {currentQuiz ? (
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
                <Badge className="px-3 py-1.5">
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Course Completed
                </Badge>
              ) : (
                <Button onClick={handleComplete} disabled={!canAdvance || completeAssignment.isPending}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {completeAssignment.isPending ? "Completing..." : "Mark Course Complete"}
                </Button>
              )
            ) : (
              <Button
                onClick={() => setStepIndex(i => Math.min(blocks.length - 1, i + 1))}
                disabled={!canAdvance}
              >
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
          {!canAdvance && (
            <p className="text-xs text-muted-foreground text-right">
              Pass the quiz above to continue.
            </p>
          )}
        </>
      )}
    </div>
  );
}
