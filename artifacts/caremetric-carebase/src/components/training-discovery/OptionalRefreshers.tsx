import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { answerSchema, refresherFeedSchema, useSaveTrainingDiscovery, useTrainingDiscovery, type RefresherLesson } from "@/hooks/useTrainingDiscovery";

export function OptionalRefreshers({ completedAssignments }: { completedAssignments: { id: string; course_id: string; status: string }[] }) {
  const feed = useTrainingDiscovery("refresher_feed", refresherFeedSchema);
  const save = useSaveTrainingDiscovery();
  const { toast } = useToast();
  const [lesson, setLesson] = useState<RefresherLesson | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [answer, setAnswer] = useState<{ correct: boolean; explanation: string; correct_answer: string } | null>(null);
  if (feed.isError) return <QueryError what="optional refreshers" error={feed.error} onRetry={() => void feed.refetch()} />;
  if (!feed.data?.enabled && !feed.data?.history.length) return null;
  const review = lesson?.course_id ? completedAssignments.find(item => item.course_id === lesson.course_id && item.status === "completed") : undefined;
  return <Card><CardHeader><CardTitle>Optional quick refreshers</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">A few minutes to revisit useful ideas. These do not change your required courses, grades, hours, or certificates. Your administrator can see your refresher responses.</p>
    {feed.data?.lessons.map(item => <div key={item.id} className="flex flex-col items-start justify-between gap-3 rounded border p-3 sm:flex-row sm:items-center"><div className="min-w-0 [overflow-wrap:anywhere]"><p className="font-medium">{item.title}</p><p className="text-sm text-muted-foreground">About {item.minutes} minutes{item.course_id ? " · Follow-up to a completed course" : ""}</p></div><Button className="shrink-0" variant="outline" onClick={() => { setLesson(item); setChoice(null); setAnswer(null); }}>Open refresher</Button></div>)}
    {!feed.data?.lessons.length && <p className="text-sm">{feed.data?.enabled ? `No refreshers ready now. Answered topics become available again after ${feed.data.frequency_days} days.` : "Your facility has paused optional refreshers."}</p>}
    {!!feed.data?.history.length && <details><summary className="cursor-pointer">Your recent refresher practice</summary><ul className="mt-2 space-y-1 text-sm">{feed.data.history.map((item, i) => <li key={`${item.answered_at}-${i}`}>{item.title} · {item.correct ? "Correct response" : "Reviewed explanation"} · {new Date(item.answered_at).toLocaleDateString()}</li>)}</ul></details>}
    <Dialog open={!!lesson} onOpenChange={open => { if (!open && !save.isPending) setLesson(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{lesson?.title}</DialogTitle></DialogHeader>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{lesson?.body.replaceAll("\\n", "\n")}</p>
      {answer ? <div role="status" className="space-y-2 rounded bg-muted p-3"><p className="font-semibold">{answer.correct ? "That's right." : "Here's the idea to take away."}</p><p>{answer.correct_answer}</p><p className="text-sm">{answer.explanation}</p></div> : <fieldset className="space-y-3"><legend className="font-medium">{lesson?.question}</legend>{lesson?.choices.map((option, index) => <label className="flex items-start gap-2 rounded border p-3" key={index}><input type="radio" name="refresher-answer" checked={choice === index} onChange={() => setChoice(index)} />{option}</label>)}</fieldset>}
      {review && <Button asChild variant="outline"><Link href={`/me/courses/${review.id}`}>Review the related course</Link></Button>}
      {answer ? <Button onClick={() => setLesson(null)}>Done</Button> : <Button disabled={choice === null || save.isPending} onClick={() => { if (!lesson || choice === null) return; save.mutate({ action: "answer_refresher", payload: { lesson_id: lesson.id, revision: lesson.revision, choice_index: choice } }, { onSuccess: result => setAnswer(answerSchema.parse(result)), onError: error => toast({ title: "Couldn't save your response", description: error.message, variant: "destructive" }) }); }}>Check answer</Button>}
    </DialogContent></Dialog>
  </CardContent></Card>;
}
