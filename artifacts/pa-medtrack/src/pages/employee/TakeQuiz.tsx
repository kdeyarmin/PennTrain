import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ListChecks, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useGetCourseAssignment } from "@/hooks/useCourseAssignments";
import { useGetCourse } from "@/hooks/useCourses";
import {
  useGetQuiz,
  useListQuizQuestions,
  useQuizAnswerChoices,
  useStartQuizAttempt,
  useSubmitQuizAttemptAnswer,
  useListQuizAttemptAnswers,
  useGradeQuizAttempt,
  useListQuizAttempts,
  useGetQuizAttempt,
} from "@/hooks/useQuizzes";

export default function TakeQuiz() {
  const { assignmentId, quizId } = useParams<{ assignmentId: string; quizId: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const backHref = `/me/courses/${assignmentId}`;

  const { data: employee, isLoading: employeeLoading } = useGetEmployeeByProfileId(user?.id);
  const { data: assignment, isLoading: assignmentLoading } = useGetCourseAssignment(assignmentId);
  const { data: course } = useGetCourse(assignment?.course_id);
  const { data: quiz, isLoading: quizLoading, isError: quizError } = useGetQuiz(quizId);
  const { data: questions, isLoading: questionsLoading, isError: questionsError } = useListQuizQuestions(quizId);
  const { data: choices, isLoading: choicesLoading, isError: choicesError } = useQuizAnswerChoices(quizId);
  const { data: attempts, isLoading: attemptsLoading } = useListQuizAttempts({
    assignmentId,
    employeeId: employee?.id,
  });

  // All attempts this employee has made at THIS quiz (useListQuizAttempts only
  // filters by assignmentId/employeeId, so quiz_id is narrowed client-side).
  // The list is already ordered started_at desc, so filtering preserves order.
  const attemptsForQuiz = useMemo(
    () => (attempts ?? []).filter((a) => a.quiz_id === quizId),
    [attempts, quizId],
  );
  const inProgressAttempt = attemptsForQuiz.find((a) => a.submitted_at === null);
  const gradedAttempts = attemptsForQuiz.filter((a) => a.submitted_at !== null);
  const lastGraded = gradedAttempts[0];
  const attemptsUsed = attemptsForQuiz.length;
  const maxAttempts = quiz?.max_attempts ?? null;
  const attemptsExhausted = !inProgressAttempt && maxAttempts != null && attemptsUsed >= maxAttempts;

  // The attempt currently being worked on in THIS session: either an
  // in-progress attempt resumed from the server, or one just started here.
  const [newAttemptId, setNewAttemptId] = useState<string | null>(null);
  const activeAttemptId = newAttemptId ?? inProgressAttempt?.id ?? null;

  const { data: activeAttempt } = useGetQuizAttempt(activeAttemptId ?? undefined);
  const { data: attemptAnswers } = useListQuizAttemptAnswers(activeAttemptId ?? undefined);

  // Local per-question selections, keyed by question_id. Seeded once from any
  // answers already saved against the active attempt (covers resuming an
  // in-progress attempt); a brand-new attempt seeds to {} since it has none.
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [seededFor, setSeededFor] = useState<string | null>(null);

  useEffect(() => {
    // Reset all local quiz-taking state when navigating to a different quiz.
    setSelections({});
    setSeededFor(null);
    setNewAttemptId(null);
  }, [quizId]);

  useEffect(() => {
    if (activeAttemptId && activeAttemptId !== seededFor && attemptAnswers) {
      const seeded: Record<string, string[]> = {};
      for (const a of attemptAnswers) seeded[a.question_id] = a.selected_answer_ids;
      setSelections(seeded);
      setSeededFor(activeAttemptId);
    }
  }, [activeAttemptId, attemptAnswers, seededFor]);

  const choicesByQuestion = useMemo(() => {
    const map = new Map<string, { id: string; question_id: string; answer_text: string; sort_order: number }[]>();
    for (const c of choices ?? []) {
      const list = map.get(c.question_id) ?? [];
      list.push(c);
      map.set(c.question_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    return map;
  }, [choices]);

  const isCorrectByQuestion = useMemo(() => {
    const map = new Map<string, boolean | null>();
    for (const a of attemptAnswers ?? []) map.set(a.question_id, a.is_correct);
    return map;
  }, [attemptAnswers]);

  const { mutate: startAttempt, isPending: starting } = useStartQuizAttempt();
  const { mutate: saveAnswer } = useSubmitQuizAttemptAnswer();
  const { mutate: gradeAttempt, isPending: grading } = useGradeQuizAttempt();

  function handleStart() {
    if (!assignmentId || !quizId) return;
    startAttempt(
      { assignment_id: assignmentId, quiz_id: quizId },
      {
        onSuccess: (data) => {
          setSelections({});
          setSeededFor(data.id);
          setNewAttemptId(data.id);
        },
        onError: (e: Error) =>
          toast({ title: "Failed to start quiz", description: e.message, variant: "destructive" }),
      },
    );
  }

  function setAnswer(questionId: string, ids: string[]) {
    setSelections((prev) => ({ ...prev, [questionId]: ids }));
    if (!activeAttemptId) return;
    saveAnswer(
      { attempt_id: activeAttemptId, question_id: questionId, selected_answer_ids: ids },
      {
        onError: (e: Error) =>
          toast({ title: "Failed to save answer", description: e.message, variant: "destructive" }),
      },
    );
  }

  const allAnswered = (questions ?? []).length > 0 && (questions ?? []).every((q) => (selections[q.id]?.length ?? 0) > 0);

  function handleSubmit() {
    if (!activeAttemptId) return;
    gradeAttempt(activeAttemptId, {
      onSuccess: () => toast({ title: "Quiz submitted" }),
      onError: (e: Error) =>
        toast({ title: "Failed to submit quiz", description: e.message, variant: "destructive" }),
    });
  }

  const isLoading =
    employeeLoading || assignmentLoading || quizLoading || questionsLoading || choicesLoading || attemptsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (!employee) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground text-center">
            No employee profile is linked to this account yet. Contact your facility manager.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!assignment) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">Assignment not found.</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/me"><ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  if (assignment.employee_id !== employee.id) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">This assignment does not belong to you.</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/me"><ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  if (quizError || !quiz || questionsError || choicesError) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">This quiz could not be loaded.</p>
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}><ArrowLeft className="mr-2 h-4 w-4" /> Back to course</Link>
        </Button>
      </div>
    );
  }

  const allQuestions = questions ?? [];

  if (allQuestions.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">This quiz has no questions yet.</p>
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}><ArrowLeft className="mr-2 h-4 w-4" /> Back to course</Link>
        </Button>
      </div>
    );
  }

  // Re-bind to a const so its narrowed (non-undefined) type is preserved
  // inside the ResultCard closure below -- TS control-flow narrowing from
  // the guard clauses above doesn't carry into nested function bodies.
  const activeQuiz = quiz;

  const isGraded = !!activeAttemptId && activeAttempt && activeAttempt.submitted_at !== null;

  function ResultCard({
    scorePercent,
    passed,
    attemptNumber,
    showRetake,
    exhausted,
  }: {
    scorePercent: number | null;
    passed: boolean | null;
    attemptNumber: number;
    showRetake: boolean;
    exhausted: boolean;
  }) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {passed ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600" />
            )}
            {passed ? "You passed!" : "You did not pass"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={passed ? "default" : "destructive"}>
              {scorePercent ?? 0}%
            </Badge>
            <span className="text-sm text-muted-foreground">
              Attempt #{attemptNumber} &middot; Passing score {activeQuiz.passing_score_percent}%
            </span>
          </div>

          {exhausted && !passed && (
            <div className="flex items-start gap-2 p-3 rounded-lg border bg-muted/30">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground">
                You've used all {maxAttempts} attempt{maxAttempts === 1 ? "" : "s"} allowed for this quiz and did not
                reach the passing score. Contact your trainer or facility manager about next steps.
              </p>
            </div>
          )}

          {attemptAnswers && attemptAnswers.length > 0 && activeAttemptId && isGraded && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Question Review</p>
              {allQuestions.map((q, idx) => {
                const correct = isCorrectByQuestion.get(q.id);
                return (
                  <div key={q.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0 text-sm">
                    <span className="min-w-0 truncate">#{idx + 1}. {q.question_text}</span>
                    {correct === true ? (
                      <Badge variant="default" className="shrink-0"><CheckCircle2 className="h-3 w-3 mr-1" /> Correct</Badge>
                    ) : correct === false ? (
                      <Badge variant="destructive" className="shrink-0"><XCircle className="h-3 w-3 mr-1" /> Incorrect</Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">Not answered</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            {showRetake && (
              <Button onClick={handleStart} disabled={starting}>
                {starting ? "Starting..." : "Retake Quiz"}
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate(backHref)}>Back to Course</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}><ArrowLeft className="mr-2 h-4 w-4" /> Back to Course</Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ListChecks className="h-6 w-6" />
          {quiz.title}
        </h1>
        {course && <p className="text-muted-foreground">{course.title}</p>}
      </div>

      {isGraded && activeAttempt ? (
        <ResultCard
          scorePercent={activeAttempt.score_percent}
          passed={activeAttempt.passed}
          attemptNumber={activeAttempt.attempt_number}
          showRetake={!activeAttempt.passed && (maxAttempts == null || attemptsUsed < maxAttempts)}
          exhausted={!activeAttempt.passed && maxAttempts != null && attemptsUsed >= maxAttempts}
        />
      ) : activeAttemptId ? (
        // --- Taking the quiz -----------------------------------------------
        // All questions are rendered at once with a single Submit button
        // (rather than one-question-at-a-time paging): quizzes in this app
        // are short comprehension checks attached to a single course block,
        // so a full-page review before submitting is more useful than a
        // multi-step wizard, and it avoids extra client-side "current
        // question index" state to keep in sync with saved answers.
        // Each answer is still persisted via useSubmitQuizAttemptAnswer as
        // soon as the learner picks it (not batched at the end), so progress
        // survives a refresh or a resumed session.
        <div className="space-y-4">
          {allQuestions.map((q, idx) => {
            const questionChoices = choicesByQuestion.get(q.id) ?? [];
            const selected = selections[q.id] ?? [];
            return (
              <Card key={q.id}>
                <CardHeader>
                  <CardTitle className="text-base font-semibold flex items-start gap-2">
                    <span className="text-muted-foreground font-normal">Q{idx + 1}.</span>
                    <span>{q.question_text}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {q.question_type === "multiple_choice" ? (
                    <div className="space-y-2">
                      {questionChoices.map((c) => (
                        <label key={c.id} className="flex items-center gap-2.5 cursor-pointer">
                          <Checkbox
                            checked={selected.includes(c.id)}
                            onCheckedChange={(checked) => {
                              const next = checked
                                ? [...selected, c.id]
                                : selected.filter((id) => id !== c.id);
                              setAnswer(q.id, next);
                            }}
                          />
                          <span className="text-sm">{c.answer_text}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <RadioGroup
                      value={selected[0] ?? ""}
                      onValueChange={(val) => setAnswer(q.id, [val])}
                      className="space-y-2"
                    >
                      {questionChoices.map((c) => (
                        <label key={c.id} className="flex items-center gap-2.5 cursor-pointer">
                          <RadioGroupItem value={c.id} id={`${q.id}-${c.id}`} />
                          <Label htmlFor={`${q.id}-${c.id}`} className="text-sm font-normal cursor-pointer">
                            {c.answer_text}
                          </Label>
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-muted-foreground">
              {Object.values(selections).filter((s) => s.length > 0).length} of {allQuestions.length} answered
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => navigate(backHref)}>Exit</Button>
              <Button onClick={handleSubmit} disabled={!allAnswered || grading}>
                {grading ? "Submitting..." : "Submit Quiz"}
              </Button>
            </div>
          </div>
        </div>
      ) : lastGraded ? (
        // --- Landing on a quiz with a prior (graded) attempt but nothing in
        // progress right now: passed already, or failed with attempts left,
        // or failed with attempts exhausted.
        <ResultCard
          scorePercent={lastGraded.score_percent}
          passed={lastGraded.passed}
          attemptNumber={lastGraded.attempt_number}
          showRetake={!lastGraded.passed && !attemptsExhausted}
          exhausted={attemptsExhausted && !lastGraded.passed}
        />
      ) : (
        // --- Never attempted this quiz -------------------------------------
        <Card>
          <CardHeader>
            <CardTitle>Ready to start?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground space-y-1">
              <p>{allQuestions.length} question{allQuestions.length === 1 ? "" : "s"}</p>
              <p>Passing score: {quiz.passing_score_percent}%</p>
              <p>{maxAttempts == null ? "Unlimited attempts" : `Up to ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"}`}</p>
            </div>
            <Button onClick={handleStart} disabled={starting}>
              {starting ? "Starting..." : "Start Quiz"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
