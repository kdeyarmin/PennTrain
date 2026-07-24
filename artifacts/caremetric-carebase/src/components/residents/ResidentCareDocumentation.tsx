import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, FilePenLine, Lock, NotebookPen, Plus, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import {
  type AssessmentType,
  type ClinicalCarePlanGoal,
  type ClinicalProgressNote,
  type ProgressNoteType,
  useAmendClinicalProgressNote,
  useFinalizeClinicalAssessment,
  useRecordClinicalAssessment,
  useResidentClinicalCare,
  useSaveCarePlanGoal,
  useSaveClinicalCarePlan,
  useSaveClinicalProgressNote,
  useSignClinicalProgressNote,
} from "@/hooks/useResidentClinicalCare";

function human(value: string) {
  return value.replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

const NOTE_TYPES: ProgressNoteType[] = ["nursing", "soap", "shift", "care_conference", "general"];
const ASSESSMENT_TYPES: AssessmentType[] = ["braden", "morse_fall", "pain", "mmse", "nutrition", "adl", "mood", "custom"];

function noteBadgeVariant(status: string): "outline" | "secondary" | "destructive" {
  if (status === "entered_in_error") return "destructive";
  if (status === "signed" || status === "amended") return "secondary";
  return "outline";
}

export function ResidentCareDocumentation({ residentId, canChart }: { residentId: string; canChart: boolean }) {
  const care = useResidentClinicalCare(residentId);
  const { toast } = useToast();

  const [noteType, setNoteType] = useState<ProgressNoteType>("nursing");
  const [noteBody, setNoteBody] = useState("");
  const saveNote = useSaveClinicalProgressNote();
  const signNote = useSignClinicalProgressNote();
  const [amending, setAmending] = useState<ClinicalProgressNote | null>(null);
  const [amendReason, setAmendReason] = useState("");
  const [amendBody, setAmendBody] = useState("");
  const amendNote = useAmendClinicalProgressNote();

  const [assessmentType, setAssessmentType] = useState<AssessmentType>("braden");
  const [assessmentScore, setAssessmentScore] = useState("");
  const [assessmentRisk, setAssessmentRisk] = useState("");
  const [assessmentLabel, setAssessmentLabel] = useState("");
  const recordAssessment = useRecordClinicalAssessment();
  const finalizeAssessment = useFinalizeClinicalAssessment();

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planTitle, setPlanTitle] = useState("");
  const [planCategory, setPlanCategory] = useState("general");
  const savePlan = useSaveClinicalCarePlan();
  const [goalPlanId, setGoalPlanId] = useState<string | null>(null);
  const [goalDescription, setGoalDescription] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const saveGoal = useSaveCarePlanGoal();

  const goalsByPlan = useMemo(() => {
    const map = new Map<string, ClinicalCarePlanGoal[]>();
    for (const goal of care.data?.goals ?? []) {
      const list = map.get(goal.care_plan_id) ?? [];
      list.push(goal);
      map.set(goal.care_plan_id, list);
    }
    return map;
  }, [care.data?.goals]);

  const submitNote = async (sign: boolean) => {
    if (noteBody.trim().length < 1) return;
    try {
      const noteId = await saveNote.mutateAsync({ residentId, noteType, body: noteBody.trim(), authoredAt: new Date().toISOString() });
      if (sign && noteId) await signNote.mutateAsync({ residentId, noteId });
      setNoteBody("");
      toast({ title: sign ? "Progress note signed" : "Draft note saved" });
    } catch (error) {
      toast({ title: "Note could not be saved", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const submitAmend = async () => {
    if (!amending || amendReason.trim().length < 3 || amendBody.trim().length < 1) return;
    try {
      await amendNote.mutateAsync({ residentId, noteId: amending.id, reason: amendReason.trim(), newBody: amendBody.trim() });
      setAmending(null); setAmendReason(""); setAmendBody("");
      toast({ title: "Note amended" });
    } catch (error) {
      toast({ title: "Note could not be amended", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const submitAssessment = async () => {
    if (assessmentType === "custom" && assessmentLabel.trim().length < 1) return;
    const score = assessmentScore.trim() === "" ? null : Number(assessmentScore);
    if (score != null && Number.isNaN(score)) { toast({ title: "Enter a valid score", variant: "destructive" }); return; }
    try {
      await recordAssessment.mutateAsync({
        residentId, assessmentType, assessedAt: new Date().toISOString(),
        score, riskBand: assessmentRisk.trim() || null, customLabel: assessmentType === "custom" ? assessmentLabel.trim() : null,
      });
      setAssessmentScore(""); setAssessmentRisk(""); setAssessmentLabel("");
      toast({ title: "Assessment recorded" });
    } catch (error) {
      toast({ title: "Assessment could not be recorded", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const submitPlan = async () => {
    if (planTitle.trim().length < 2) return;
    try {
      await savePlan.mutateAsync({ residentId, title: planTitle.trim(), category: planCategory.trim() || "general", status: "active" });
      setPlanDialogOpen(false); setPlanTitle(""); setPlanCategory("general");
      toast({ title: "Care plan created" });
    } catch (error) {
      toast({ title: "Care plan could not be created", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const submitGoal = async () => {
    if (!goalPlanId || goalDescription.trim().length < 2) return;
    try {
      await saveGoal.mutateAsync({ residentId, carePlanId: goalPlanId, description: goalDescription.trim(), targetMeasure: goalTarget.trim() || null });
      setGoalPlanId(null); setGoalDescription(""); setGoalTarget("");
      toast({ title: "Goal added" });
    } catch (error) {
      toast({ title: "Goal could not be added", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  if (care.isError) return <QueryError what="clinical documentation" error={care.error} onRetry={() => care.refetch()} />;

  return (
    <Tabs defaultValue="notes" className="space-y-4">
      <TabsList>
        <TabsTrigger value="notes">Progress notes</TabsTrigger>
        <TabsTrigger value="assessments">Assessments</TabsTrigger>
        <TabsTrigger value="careplan">Care plan</TabsTrigger>
      </TabsList>

      <TabsContent value="notes" className="space-y-3">
        {canChart && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><NotebookPen className="h-4 w-4" />New progress note</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-48 space-y-1"><Label>Note type</Label>
                  <Select value={noteType} onValueChange={(value) => setNoteType(value as ProgressNoteType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{NOTE_TYPES.map((type) => <SelectItem key={type} value={type}>{human(type)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <Textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="Document the observation or care provided…" rows={4} />
              <div className="flex gap-2">
                <Button variant="outline" disabled={saveNote.isPending || noteBody.trim().length < 1} onClick={() => void submitNote(false)}>Save draft</Button>
                <Button disabled={saveNote.isPending || signNote.isPending || noteBody.trim().length < 1} onClick={() => void submitNote(true)}><Lock className="mr-2 h-4 w-4" />Save &amp; sign</Button>
              </div>
            </CardContent>
          </Card>
        )}
        {care.isLoading ? <Card><CardContent className="p-4"><Skeleton className="h-6 w-full" /></CardContent></Card>
          : (care.data?.notes ?? []).length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No progress notes yet.</CardContent></Card>
          : (care.data?.notes ?? []).map((note) => (
            <Card key={note.id} className={note.status === "entered_in_error" ? "opacity-70" : ""}>
              <CardContent className="p-4">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{human(note.note_type)}</Badge>
                    <Badge variant={noteBadgeVariant(note.status)}>{human(note.status)}</Badge>
                  </div>
                  {canChart && (note.status === "signed" || note.status === "amended") && (
                    <Button size="sm" variant="ghost" onClick={() => { setAmending(note); setAmendReason(""); setAmendBody(note.body); }}><FilePenLine className="mr-1 h-3.5 w-3.5" />Amend</Button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {note.author_name ? `${note.author_name} · ` : ""}{new Date(note.authored_at).toLocaleString()}
                  {note.signed_at ? ` · signed ${new Date(note.signed_at).toLocaleString()}` : ""}
                </p>
              </CardContent>
            </Card>
          ))}
      </TabsContent>

      <TabsContent value="assessments" className="space-y-3">
        {canChart && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" />Record assessment</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="w-44 space-y-1"><Label>Instrument</Label>
                <Select value={assessmentType} onValueChange={(value) => setAssessmentType(value as AssessmentType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ASSESSMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{human(type)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {assessmentType === "custom" && <div className="w-44 space-y-1"><Label>Label</Label><Input value={assessmentLabel} onChange={(event) => setAssessmentLabel(event.target.value)} /></div>}
              <div className="w-24 space-y-1"><Label>Score</Label><Input inputMode="decimal" value={assessmentScore} onChange={(event) => setAssessmentScore(event.target.value)} /></div>
              <div className="w-36 space-y-1"><Label>Risk band</Label><Input value={assessmentRisk} onChange={(event) => setAssessmentRisk(event.target.value)} placeholder="e.g. moderate" /></div>
              <Button disabled={recordAssessment.isPending || (assessmentType === "custom" && assessmentLabel.trim().length < 1)} onClick={() => void submitAssessment()}><Plus className="mr-2 h-4 w-4" />Record</Button>
            </CardContent>
          </Card>
        )}
        {(care.data?.assessments ?? []).length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No assessments recorded.</CardContent></Card>
          : (care.data?.assessments ?? []).map((assessment) => (
            <Card key={assessment.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <p className="font-medium">{assessment.assessment_type === "custom" ? assessment.custom_label : human(assessment.assessment_type)}</p>
                  <Badge variant={assessment.status === "final" ? "secondary" : "outline"}>{human(assessment.status)}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {assessment.score != null ? `Score ${assessment.score}` : "No score"}{assessment.risk_band ? ` · ${assessment.risk_band}` : ""} · {new Date(assessment.assessed_at).toLocaleString()}
                </p>
              </div>
              {canChart && assessment.status === "draft" && (
                <Button size="sm" variant="outline" disabled={finalizeAssessment.isPending} onClick={() => void finalizeAssessment.mutateAsync({ residentId, assessmentId: assessment.id })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Finalize</Button>
              )}
            </CardContent></Card>
          ))}
      </TabsContent>

      <TabsContent value="careplan" className="space-y-3">
        {canChart && <div><Button variant="outline" onClick={() => setPlanDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />New care plan</Button></div>}
        {(care.data?.carePlans ?? []).length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No care plans yet.</CardContent></Card>
          : (care.data?.carePlans ?? []).map((plan) => (
            <Card key={plan.id}>
              <CardHeader className="pb-2"><div className="flex items-center justify-between gap-2">
                <div><CardTitle className="text-base">{plan.title}</CardTitle><CardDescription>{human(plan.category)}</CardDescription></div>
                <Badge variant={plan.status === "active" ? "secondary" : "outline"}>{human(plan.status)}</Badge>
              </div></CardHeader>
              <CardContent className="space-y-2">
                {(goalsByPlan.get(plan.id) ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No goals yet.</p> : (
                  <ul className="space-y-1">
                    {(goalsByPlan.get(plan.id) ?? []).map((goal) => (
                      <li key={goal.id} className="flex items-start gap-2 text-sm"><Target className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" /><span>{goal.description}{goal.target_measure ? ` — ${goal.target_measure}` : ""}</span><Badge variant="outline" className="ml-auto">{human(goal.status)}</Badge></li>
                    ))}
                  </ul>
                )}
                {canChart && <Button size="sm" variant="ghost" onClick={() => { setGoalPlanId(plan.id); setGoalDescription(""); setGoalTarget(""); }}><Plus className="mr-1 h-3.5 w-3.5" />Add goal</Button>}
              </CardContent>
            </Card>
          ))}
      </TabsContent>

      <Dialog open={!!amending} onOpenChange={(open) => { if (!open) setAmending(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Amend progress note</DialogTitle><DialogDescription>The prior content is preserved in the append-only note history.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="amend-reason">Reason</Label><Input id="amend-reason" value={amendReason} onChange={(event) => setAmendReason(event.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="amend-body">Amended note</Label><Textarea id="amend-body" value={amendBody} onChange={(event) => setAmendBody(event.target.value)} rows={5} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAmending(null)}>Cancel</Button><Button disabled={amendNote.isPending || amendReason.trim().length < 3 || amendBody.trim().length < 1} onClick={() => void submitAmend()}>Save amendment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New care plan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="plan-title">Title</Label><Input id="plan-title" value={planTitle} onChange={(event) => setPlanTitle(event.target.value)} placeholder="Falls prevention" /></div>
            <div className="space-y-1"><Label htmlFor="plan-category">Category</Label><Input id="plan-category" value={planCategory} onChange={(event) => setPlanCategory(event.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPlanDialogOpen(false)}>Cancel</Button><Button disabled={savePlan.isPending || planTitle.trim().length < 2} onClick={() => void submitPlan()}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!goalPlanId} onOpenChange={(open) => { if (!open) setGoalPlanId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add goal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="goal-desc">Goal</Label><Input id="goal-desc" value={goalDescription} onChange={(event) => setGoalDescription(event.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="goal-target">Target measure</Label><Input id="goal-target" value={goalTarget} onChange={(event) => setGoalTarget(event.target.value)} placeholder="e.g. No falls in 90 days" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setGoalPlanId(null)}>Cancel</Button><Button disabled={saveGoal.isPending || goalDescription.trim().length < 2} onClick={() => void submitGoal()}>Add goal</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
