import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useOfflineCourseBundle, useOfflineProgress, useQueueOfflineProgress, useSyncOfflineProgress } from "@/hooks/useOfflineLearning";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, CloudOff, CloudUpload, FileQuestion, Loader2, PlayCircle, ShieldCheck } from "lucide-react";

interface OfflineQuestion {
  id: string;
  questionText: string;
  questionType: string;
  answers: Array<{ id: string; answerText: string; sortOrder: number }>;
}
interface OfflineBlock {
  id: string;
  type: string;
  title: string | null;
  body: { content?: string } | string | null;
  videoUrl: string | null;
  quiz: { id: string; title: string; passingScorePercent: number; questions: OfflineQuestion[] } | null;
}
interface OfflineBundle {
  assignment: { id: string; dueDate: string | null; status: string; serverBaseVersion: number };
  course: { id: string; title: string; description: string | null; category: string | null };
  version: { id: string; versionNumber: number; title: string | null; description: string | null };
  blocks: OfflineBlock[];
}

function textContent(body: OfflineBlock["body"]) {
  if (typeof body === "string") return body;
  return body?.content ?? "No written content is available for this lesson.";
}

export default function OfflineCourse() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { toast } = useToast();
  const offlineBundle = useOfflineCourseBundle(assignmentId);
  const progress = useOfflineProgress(assignmentId);
  const queueProgress = useQueueOfflineProgress();
  const syncProgress = useSyncOfflineProgress();
  const [stepIndex, setStepIndex] = useState(0);

  const record = offlineBundle.data?.record;
  const bundle = offlineBundle.data?.bundle.data as OfflineBundle | undefined;
  const blocks = useMemo(() => bundle?.blocks ?? [], [bundle?.blocks]);
  const current = blocks[stepIndex];
  const percentComplete = blocks.length ? Math.round(((stepIndex + 1) / blocks.length) * 100) : 0;
  const hasUnsyncedProgress = (progress.data?.percentComplete ?? 0) > (progress.data?.syncedPercent ?? 0);

  const recordProgress = async (nextIndex: number) => {
    if (!bundle || !blocks.length) return;
    setStepIndex(nextIndex);
    const viewedPercent = Math.round(((nextIndex + 1) / blocks.length) * 100);
    try {
      await queueProgress.mutateAsync({
        assignmentId,
        percentComplete: viewedPercent,
        baseVersion: bundle.assignment.serverBaseVersion,
      });
      if (navigator.onLine) await syncProgress.mutateAsync(assignmentId);
    } catch (error) {
      toast({
        title: navigator.onLine ? "Progress is still stored on this device" : "Progress saved for later sync",
        description: error instanceof Error ? error.message : "Reconnect to synchronize this checkpoint.",
        variant: navigator.onLine ? "destructive" : "default",
      });
    }
  };

  const handleSync = async () => {
    try {
      const result = await syncProgress.mutateAsync(assignmentId);
      const outcome = result?.lastOutcome;
      if (outcome === "conflict") {
        toast({ title: "Progress needs review", description: "The online course changed after this copy was downloaded. Open the live course to reconcile progress.", variant: "destructive" });
      } else if (outcome === "wipe_required") {
        toast({ title: "This device copy was revoked", description: "Return to My Training and wipe the offline library.", variant: "destructive" });
      } else {
        toast({ title: "Offline progress synchronized" });
      }
    } catch (error) {
      toast({ title: "Progress could not synchronize", description: error instanceof Error ? error.message : "Try again when connected.", variant: "destructive" });
    }
  };

  if (offlineBundle.isLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-7 w-7 animate-spin" /><span className="sr-only">Decrypting offline course</span></div>;
  }
  if (offlineBundle.isError || !bundle || !record) {
    return <Card><CardHeader><CardTitle>Offline course unavailable</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{offlineBundle.error instanceof Error ? offlineBundle.error.message : "This course is not stored on this device."}</p><Button asChild><Link href="/me/courses"><ArrowLeft className="mr-2 h-4 w-4" />Return to My Training</Link></Button></CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm" className="-ml-3"><Link href="/me/courses"><ArrowLeft className="mr-2 h-4 w-4" />My Training</Link></Button>
          <h1 className="text-2xl font-bold tracking-tight">{bundle.course.title}</h1>
          <p className="text-sm text-muted-foreground">Secure offline copy · downloaded {new Date(record.downloadedAt).toLocaleString()}</p>
        </div>
        <Badge variant="outline" className="gap-1"><CloudOff className="h-3.5 w-3.5" />Offline mode</Badge>
      </div>

      <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Device-bound learning copy</AlertTitle><AlertDescription>Course content is decrypted only for this signed-in employee on this device. Viewed progress is queued locally and can sync when connected. Quizzes, attestations, and regulated completion documentation require the live course.</AlertDescription></Alert>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center justify-between text-sm"><span>Lesson {Math.min(stepIndex + 1, blocks.length)} of {blocks.length}</span><span>{percentComplete}% viewed</span></div>
          <Progress value={percentComplete} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{progress.data?.syncedPercent ? `${progress.data.syncedPercent}% synchronized` : "No offline progress synchronized yet"}</span>
            <div className="flex flex-wrap gap-2">
              {percentComplete > (progress.data?.percentComplete ?? 0) && <Button size="sm" variant="outline" disabled={queueProgress.isPending} onClick={() => void recordProgress(stepIndex)}>Save {percentComplete}% checkpoint</Button>}
              {hasUnsyncedProgress && <Button size="sm" variant="outline" disabled={!navigator.onLine || syncProgress.isPending} onClick={handleSync}>{syncProgress.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />}Sync {progress.data?.percentComplete}% progress</Button>}
            </div>
          </div>
        </CardContent>
      </Card>

      {!current ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">This downloaded version has no course blocks.</CardContent></Card> : <Card>
        <CardHeader><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{current.type.replace(/_/g, " ")}</Badge>{current.type === "quiz" && <Badge variant="outline"><FileQuestion className="mr-1 h-3 w-3" />Review only</Badge>}</div><CardTitle className="flex items-center gap-2">{current.type === "video" ? <PlayCircle className="h-5 w-5" /> : <BookOpen className="h-5 w-5" />}{current.title ?? `Lesson ${stepIndex + 1}`}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {current.type === "text" && <p className="whitespace-pre-wrap rounded-lg border bg-muted/20 p-4 text-sm leading-7">{textContent(current.body)}</p>}
          {current.type === "video" && <div className="space-y-3 rounded-lg border p-4"><p className="text-sm text-muted-foreground">Video assets are streamed only when a connection is available; the lesson title and sequence remain available offline.</p>{current.videoUrl && navigator.onLine && <Button asChild variant="outline"><a href={current.videoUrl} target="_blank" rel="noreferrer"><PlayCircle className="mr-2 h-4 w-4" />Open video</a></Button>}</div>}
          {(current.type === "pdf" || current.type === "scorm") && <p className="rounded-lg border p-4 text-sm text-muted-foreground">Protected document and package assets are not embedded in the offline copy. Reconnect and open the live course to view this lesson.</p>}
          {current.type === "quiz" && <div className="space-y-4">{current.quiz?.questions?.map((question, index) => <div key={question.id} className="rounded-lg border p-4"><p className="font-medium">{index + 1}. {question.questionText}</p><div className="mt-3 space-y-2">{question.answers.map((answer) => <div key={answer.id} className="rounded border bg-muted/20 px-3 py-2 text-sm">{answer.answerText}</div>)}</div></div>)}<Alert><CheckCircle2 className="h-4 w-4" /><AlertTitle>Reconnect to submit</AlertTitle><AlertDescription>Answer keys are intentionally excluded from offline storage. Take this knowledge check in the live course so attempts and documentation are recorded.</AlertDescription></Alert></div>}
          {!(["text", "video", "pdf", "scorm", "quiz"].includes(current.type)) && <p className="whitespace-pre-wrap text-sm">{textContent(current.body)}</p>}
        </CardContent>
      </Card>}

      <div className="flex justify-between gap-3">
        <Button variant="outline" disabled={stepIndex === 0} onClick={() => recordProgress(Math.max(0, stepIndex - 1))}><ArrowLeft className="mr-2 h-4 w-4" />Previous</Button>
        {stepIndex < blocks.length - 1 ? <Button onClick={() => recordProgress(stepIndex + 1)}>Next<ArrowRight className="ml-2 h-4 w-4" /></Button> : <Button asChild><Link href={`/me/courses/${assignmentId}`}>Open live course<CloudUpload className="ml-2 h-4 w-4" /></Link></Button>}
      </div>
    </div>
  );
}
