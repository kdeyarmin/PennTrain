import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ListChecks, Pencil, Plus, Trash2, Lock } from "lucide-react";
import {
  useGetQuiz, useUpdateQuiz,
  useListQuizQuestions, useCreateQuizQuestion, useUpdateQuizQuestion, useDeleteQuizQuestion,
  useListQuizAnswers, useCreateQuizAnswer, useUpdateQuizAnswer, useDeleteQuizAnswer,
  useQuizQuestionStats,
  type QuizQuestion, type QuizAnswer, type QuestionStats,
} from "@/hooks/useQuizzes";
import { useGetCourseBlock, useGetCourseVersion, useGetCourse } from "@/hooks/useCourses";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const QUESTION_TYPE_LABEL: Record<string, string> = {
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  true_false: "True / False",
};

interface QuestionFormState {
  question_text: string;
  question_type: "single_choice" | "multiple_choice" | "true_false";
  points: string;
  explanation: string;
}

const EMPTY_QUESTION_FORM: QuestionFormState = {
  question_text: "",
  question_type: "single_choice",
  points: "1",
  explanation: "",
};

function AnswerRow({
  answer,
  questionType,
  locked,
  onMarkCorrect,
  onToggleCorrect,
  onDelete,
}: {
  answer: QuizAnswer;
  questionType: string;
  locked: boolean;
  onMarkCorrect: () => void;
  onToggleCorrect: (checked: boolean) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(answer.answer_text);
  const { mutate: updateAnswer } = useUpdateQuizAnswer();

  useEffect(() => setText(answer.answer_text), [answer.answer_text]);

  const commitText = () => {
    if (text.trim() && text !== answer.answer_text) {
      updateAnswer({ id: answer.id, answer_text: text.trim() });
    } else if (!text.trim()) {
      setText(answer.answer_text);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {questionType === "multiple_choice" ? (
        <Checkbox
          checked={answer.is_correct}
          disabled={locked}
          onCheckedChange={(checked) => onToggleCorrect(!!checked)}
          aria-label="Mark as correct"
        />
      ) : (
        <button
          type="button"
          disabled={locked}
          onClick={onMarkCorrect}
          aria-label="Mark as the correct answer"
          className={`h-4 w-4 rounded-full border shrink-0 ${answer.is_correct ? "bg-primary border-primary" : "border-muted-foreground/40"} disabled:opacity-50`}
        />
      )}
      <Input
        value={text}
        disabled={locked}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        className="h-8 text-sm"
      />
      {answer.is_correct && <Badge variant="outline" className="text-[10px] shrink-0">Correct</Badge>}
      {!locked && (
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="Delete answer">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function DifficultyBadge({ stats }: { stats: QuestionStats | undefined }) {
  if (!stats || stats.totalGraded === 0) {
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">No attempts yet</Badge>;
  }
  const variant = stats.incorrectRate >= 50 ? "destructive" : stats.incorrectRate >= 20 ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="text-[10px]">
      {stats.incorrectRate}% missed &middot; {stats.totalGraded} attempt{stats.totalGraded === 1 ? "" : "s"}
    </Badge>
  );
}

function QuestionCard({
  question,
  index,
  locked,
  stats,
  onEdit,
  onDelete,
}: {
  question: QuizQuestion;
  index: number;
  locked: boolean;
  stats: QuestionStats | undefined;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { data: answers, isLoading } = useListQuizAnswers(question.id);
  const { toast } = useToast();
  const { mutate: createAnswer, isPending: creatingAnswer } = useCreateQuizAnswer();
  const { mutate: updateAnswer } = useUpdateQuizAnswer();
  const { mutate: deleteAnswer } = useDeleteQuizAnswer();

  const handleAddAnswer = () => {
    const nextSort = (answers?.reduce((max, a) => Math.max(max, a.sort_order), -1) ?? -1) + 1;
    createAnswer(
      {
        question_id: question.id,
        organization_id: question.organization_id,
        answer_text: "New answer option",
        is_correct: false,
        sort_order: nextSort,
      },
      { onError: (e: Error) => toast({ title: "Failed to add answer", description: e.message, variant: "destructive" }) },
    );
  };

  const handleMarkCorrect = (answer: QuizAnswer) => {
    for (const a of answers ?? []) {
      if (a.id !== answer.id && a.is_correct) {
        updateAnswer({ id: a.id, is_correct: false });
      }
    }
    updateAnswer(
      { id: answer.id, is_correct: true },
      { onError: (e: Error) => toast({ title: "Failed to update answer", description: e.message, variant: "destructive" }) },
    );
  };

  const handleToggleCorrect = (answer: QuizAnswer, checked: boolean) => {
    updateAnswer(
      { id: answer.id, is_correct: checked },
      { onError: (e: Error) => toast({ title: "Failed to update answer", description: e.message, variant: "destructive" }) },
    );
  };

  const handleDeleteAnswer = (answer: QuizAnswer) => {
    deleteAnswer(
      { id: answer.id, questionId: question.id },
      { onError: (e: Error) => toast({ title: "Failed to delete answer", description: e.message, variant: "destructive" }) },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs text-muted-foreground">Q{index + 1}</span>
              <Badge variant="outline" className="text-[10px]">{QUESTION_TYPE_LABEL[question.question_type] ?? question.question_type}</Badge>
              <Badge variant="secondary" className="text-[10px]">{question.points} pt{question.points === 1 ? "" : "s"}</Badge>
              <DifficultyBadge stats={stats} />
            </div>
            <CardTitle className="text-base font-semibold">{question.question_text}</CardTitle>
            {question.explanation && (
              <p className="text-xs text-muted-foreground mt-1 italic">Explanation: {question.explanation}</p>
            )}
          </div>
          {!locked && (
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} aria-label="Edit question">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="Delete question">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : !answers || answers.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No answer choices yet.</p>
        ) : (
          <div className="space-y-2">
            {answers.map((a) => (
              <AnswerRow
                key={a.id}
                answer={a}
                questionType={question.question_type}
                locked={locked}
                onMarkCorrect={() => handleMarkCorrect(a)}
                onToggleCorrect={(checked) => handleToggleCorrect(a, checked)}
                onDelete={() => handleDeleteAnswer(a)}
              />
            ))}
          </div>
        )}
        {!locked && (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={handleAddAnswer} disabled={creatingAnswer}>
            <Plus className="h-3 w-3 mr-1" /> Add answer choice
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function QuizBuilder() {
  const { quizId } = useParams<{ quizId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  const canManage = user?.role === "org_admin" || user?.role === "trainer";

  const { data: quiz, isLoading: quizLoading } = useGetQuiz(quizId);
  const { data: courseBlock } = useGetCourseBlock(quiz?.course_block_id);
  const { data: courseVersion } = useGetCourseVersion(courseBlock?.course_version_id);
  const { data: course } = useGetCourse(courseVersion?.course_id);
  const { data: questions, isLoading: questionsLoading } = useListQuizQuestions(quizId);
  const { data: questionStats } = useQuizQuestionStats((questions ?? []).map(q => q.id));

  const isLocked = !canManage || courseVersion?.status === "published";

  // --- Quiz metadata edit ---
  const [showEditQuiz, setShowEditQuiz] = useState(false);
  const [quizForm, setQuizForm] = useState({ title: "", passingScore: "80", maxAttempts: "" });
  const { mutate: updateQuiz, isPending: savingQuiz } = useUpdateQuiz();

  const openEditQuiz = () => {
    if (!quiz) return;
    setQuizForm({
      title: quiz.title,
      passingScore: String(quiz.passing_score_percent),
      maxAttempts: quiz.max_attempts != null ? String(quiz.max_attempts) : "",
    });
    setShowEditQuiz(true);
  };

  const handleSaveQuiz = () => {
    if (!quiz) return;
    if (!quizForm.title.trim()) {
      toast({ title: "Quiz title is required", variant: "destructive" });
      return;
    }
    const passingScore = Number(quizForm.passingScore);
    updateQuiz(
      {
        id: quiz.id,
        title: quizForm.title.trim(),
        passing_score_percent: Number.isFinite(passingScore) ? passingScore : quiz.passing_score_percent,
        max_attempts: quizForm.maxAttempts.trim() ? Number(quizForm.maxAttempts) : null,
      },
      {
        onSuccess: () => { toast({ title: "Quiz updated" }); setShowEditQuiz(false); },
        onError: (e: Error) => toast({ title: "Failed to update quiz", description: e.message, variant: "destructive" }),
      },
    );
  };

  // --- Question add/edit ---
  const [showQuestionDialog, setShowQuestionDialog] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuizQuestion | null>(null);
  const [questionForm, setQuestionForm] = useState<QuestionFormState>(EMPTY_QUESTION_FORM);
  const { mutate: createQuestion, isPending: creatingQuestion } = useCreateQuizQuestion();
  const { mutate: updateQuestion, isPending: updatingQuestion } = useUpdateQuizQuestion();
  const { mutate: deleteQuestion, isPending: deletingQuestion } = useDeleteQuizQuestion();
  const [questionPendingDelete, setQuestionPendingDelete] = useState<QuizQuestion | null>(null);

  const openAddQuestion = () => {
    setEditingQuestion(null);
    setQuestionForm(EMPTY_QUESTION_FORM);
    setShowQuestionDialog(true);
  };

  const openEditQuestion = (q: QuizQuestion) => {
    setEditingQuestion(q);
    setQuestionForm({
      question_text: q.question_text,
      question_type: q.question_type as QuestionFormState["question_type"],
      points: String(q.points),
      explanation: q.explanation ?? "",
    });
    setShowQuestionDialog(true);
  };

  const handleSaveQuestion = () => {
    if (!quiz) return;
    if (!questionForm.question_text.trim()) {
      toast({ title: "Question text is required", variant: "destructive" });
      return;
    }
    const points = Number(questionForm.points);
    if (editingQuestion) {
      updateQuestion(
        {
          id: editingQuestion.id,
          question_text: questionForm.question_text.trim(),
          question_type: questionForm.question_type,
          points: Number.isFinite(points) && points > 0 ? points : 1,
          explanation: questionForm.explanation.trim() || null,
        },
        {
          onSuccess: () => { toast({ title: "Question updated" }); setShowQuestionDialog(false); },
          onError: (e: Error) => toast({ title: "Failed to update question", description: e.message, variant: "destructive" }),
        },
      );
    } else {
      const nextSort = (questions?.reduce((max, q) => Math.max(max, q.sort_order), -1) ?? -1) + 1;
      createQuestion(
        {
          quiz_id: quiz.id,
          organization_id: quiz.organization_id,
          question_text: questionForm.question_text.trim(),
          question_type: questionForm.question_type,
          points: Number.isFinite(points) && points > 0 ? points : 1,
          explanation: questionForm.explanation.trim() || null,
          sort_order: nextSort,
        },
        {
          onSuccess: () => { toast({ title: "Question added" }); setShowQuestionDialog(false); },
          onError: (e: Error) => toast({ title: "Failed to add question", description: e.message, variant: "destructive" }),
        },
      );
    }
  };

  const handleDeleteQuestion = () => {
    if (!questionPendingDelete || !quizId) return;
    deleteQuestion(
      { id: questionPendingDelete.id, quizId },
      {
        onSuccess: () => { toast({ title: "Question removed" }); setQuestionPendingDelete(null); },
        onError: (e: Error) => toast({ title: "Failed to remove question", description: e.message, variant: "destructive" }),
      },
    );
  };

  if (quizLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Quiz not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/app/courses">Back to Courses</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={course ? `/app/courses/${course.id}` : "/app/courses"}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Course
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <ListChecks className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{quiz.title}</h1>
            <p className="text-muted-foreground">
              {course?.title ?? "Course"} &middot; passing score {quiz.passing_score_percent}%
              {quiz.max_attempts ? ` · max ${quiz.max_attempts} attempt${quiz.max_attempts === 1 ? "" : "s"}` : " · unlimited attempts"}
            </p>
          </div>
        </div>
        {canManage && !isLocked && (
          <Button variant="outline" size="sm" onClick={openEditQuiz}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit Quiz
          </Button>
        )}
      </div>

      {isLocked && canManage && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Lock className="h-3 w-3" /> This quiz's course version is published and locked; create a new course version to make changes.
        </p>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>Questions</CardTitle>
            {canManage && !isLocked && (
              <Button size="sm" onClick={openAddQuestion}>
                <Plus className="mr-2 h-3.5 w-3.5" /> Add Question
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {questionsLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : !questions || questions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No questions yet.</p>
              {canManage && !isLocked && (
                <p className="text-xs text-muted-foreground/70 mt-1">Add one to start building this quiz.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map((q, idx) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  index={idx}
                  locked={isLocked}
                  stats={questionStats?.[q.id]}
                  onEdit={() => openEditQuestion(q)}
                  onDelete={() => setQuestionPendingDelete(q)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit quiz metadata */}
      <Dialog open={showEditQuiz} onOpenChange={o => { if (!o) setShowEditQuiz(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Quiz</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Quiz Title *</Label>
              <Input value={quizForm.title} onChange={e => setQuizForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Passing Score (%)</Label>
                <Input type="number" min="0" max="100" value={quizForm.passingScore} onChange={e => setQuizForm(f => ({ ...f, passingScore: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Max Attempts</Label>
                <Input type="number" min="1" value={quizForm.maxAttempts} onChange={e => setQuizForm(f => ({ ...f, maxAttempts: e.target.value }))} placeholder="Unlimited" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditQuiz(false)}>Cancel</Button>
            <Button onClick={handleSaveQuiz} disabled={savingQuiz}>{savingQuiz ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/edit question */}
      <Dialog open={showQuestionDialog} onOpenChange={o => { if (!o) setShowQuestionDialog(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingQuestion ? "Edit Question" : "Add Question"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Question Text *</Label>
              <Textarea
                value={questionForm.question_text}
                onChange={e => setQuestionForm(f => ({ ...f, question_text: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Question Type</Label>
                <Select
                  value={questionForm.question_type}
                  onValueChange={v => setQuestionForm(f => ({ ...f, question_type: v as QuestionFormState["question_type"] }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single_choice">Single choice</SelectItem>
                    <SelectItem value="multiple_choice">Multiple choice</SelectItem>
                    <SelectItem value="true_false">True / False</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Points</Label>
                <Input type="number" min="1" value={questionForm.points} onChange={e => setQuestionForm(f => ({ ...f, points: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Explanation (optional)</Label>
              <Textarea
                value={questionForm.explanation}
                onChange={e => setQuestionForm(f => ({ ...f, explanation: e.target.value }))}
                placeholder="Shown to learners after they finish the quiz, to reinforce why the correct answer is correct."
                rows={2}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Answer choices are added on the question card after saving.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQuestionDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveQuestion} disabled={creatingQuestion || updatingQuestion}>
              {creatingQuestion || updatingQuestion ? "Saving..." : editingQuestion ? "Save Changes" : "Add Question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete question confirmation */}
      <AlertDialog open={!!questionPendingDelete} onOpenChange={o => { if (!o) setQuestionPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Question</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this question and all of its answer choices? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteQuestion}
              disabled={deletingQuestion}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingQuestion ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
