import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Sparkles, Loader2, AlertCircle, ListChecks } from "lucide-react";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useListOrganizations } from "@/hooks/useOrganizations";
import { useGenerateCourseCurriculum } from "@/hooks/useAiCourseGeneration";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { coursesListPath, courseDetailPath } from "@/lib/courseRoutes";

interface WizardFormState {
  generationMode: "course" | "training_plan";
  organizationId: string;
  planName: string;
  courseCount: string;
  titleHint: string;
  category: string;
  trainingTypeId: string;
  sourceMaterial: string;
  desiredModuleCount: string;
  desiredDurationMinutes: string;
  notes: string;
}

const NO_TRAINING_TYPE = "none";

const EMPTY_FORM: WizardFormState = {
  generationMode: "course",
  organizationId: "",
  planName: "",
  courseCount: "3",
  titleHint: "",
  category: "",
  trainingTypeId: NO_TRAINING_TYPE,
  sourceMaterial: "",
  desiredModuleCount: "",
  desiredDurationMinutes: "",
  notes: "",
};

export default function AiCourseWizard() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });
  const { data: organizations } = useListOrganizations();

  // Plain useState, matching Courses.tsx's "New Training Content" dialog convention --
  // this page is the AI counterpart to that manual form, not a wizard-library form.
  const [form, setForm] = useState<WizardFormState>(EMPTY_FORM);
  const { mutate: generate, isPending, isError, error, reset } = useGenerateCourseCurriculum();

  const field = <K extends keyof WizardFormState>(k: K, v: WizardFormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  // Mirrors the Edge Function's own validation (at least one of plan_name,
  // title_hint, source_material, or notes is required) so we can catch it
  // before round-tripping.
  const hasEnoughToGenerate = !!(form.titleHint.trim() || form.planName.trim() || form.sourceMaterial.trim() || form.notes.trim());

  const handleGenerate = () => {
    if (form.generationMode === "training_plan" && !form.organizationId) {
      toast({ title: "Organization required", description: "Choose the organization that will own this training plan.", variant: "destructive" });
      return;
    }
    if (!hasEnoughToGenerate) {
      toast({
        title: "More detail needed",
        description: "Provide at least a working title, source material, or notes so the AI has something to draft from.",
        variant: "destructive",
      });
      return;
    }

    const moduleCount = form.desiredModuleCount.trim() ? Number(form.desiredModuleCount) : undefined;
    const durationMinutes = form.desiredDurationMinutes.trim() ? Number(form.desiredDurationMinutes) : undefined;
    const courseCountRaw = form.courseCount.trim() ? Number(form.courseCount) : undefined;
    const courseCount = courseCountRaw !== undefined && Number.isFinite(courseCountRaw) ? Math.trunc(courseCountRaw) : undefined;

    if (form.generationMode === "training_plan" && courseCount !== undefined && courseCount < 2) {
      toast({ title: "Course count must be at least 2", description: "Training plans must include at least 2 courses.", variant: "destructive" });
      return;
    }
    generate(
      {
        generationMode: form.generationMode,
        organizationId: form.generationMode === "training_plan" ? form.organizationId : undefined,
        planName: form.planName.trim() || undefined,
        courseCount: courseCount !== undefined && Number.isFinite(courseCount) ? courseCount : undefined,
        titleHint: form.titleHint.trim() || undefined,
        category: form.category.trim() || undefined,
        trainingTypeId: form.trainingTypeId === NO_TRAINING_TYPE ? undefined : form.trainingTypeId,
        sourceMaterial: form.sourceMaterial.trim() || undefined,
        desiredModuleCount: moduleCount !== undefined && Number.isFinite(moduleCount) ? moduleCount : undefined,
        desiredDurationMinutes: durationMinutes !== undefined && Number.isFinite(durationMinutes) ? durationMinutes : undefined,
        notes: form.notes.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          if (result.training_plan_id) {
            toast({ title: "Training plan generated", description: `${result.courses?.length ?? 0} AI course drafts were added to the plan. Review each course before publishing.` });
            navigate("/admin/training-plans");
            return;
          }
          toast({ title: "Course draft generated", description: "Review the content below before publishing." });
          navigate(courseDetailPath(result.course_id!, user?.role));
        },
        // No onError handler needed: the mutation's own isError/error state (read
        // below) drives the inline error + "Try Again" UI, and the form values are
        // untouched either way since we never clear `form` on failure.
      },
    );
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={coursesListPath(user?.role)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Training Content
          </Link>
        </Button>
      </div>

      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Generate Courses with AI</h1>
          <p className="text-muted-foreground">
            Super admins can draft one course or a complete multi-course training plan with modules, video scripts,
            and quizzes. Everything stays draft-only until a human reviews and publishes it.
          </p>
        </div>
      </div>

      {isPending ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center justify-center text-center gap-3">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="font-medium">Generating with Claude -- this can take up to a minute.</p>
            <p className="text-sm text-muted-foreground max-w-md">
              Claude is drafting modules, lesson content, and knowledge-check quizzes. You'll land straight in the
              course editor to review everything once it's ready.
            </p>
            <p className="text-sm text-muted-foreground max-w-md">
              This runs on our servers, not in your browser tab -- you don't have to sit and wait. Feel free to
              navigate away and check back later.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-1">
              <Link href="/admin/ai-generations">
                <ListChecks className="mr-2 h-3.5 w-3.5" /> View Generation Log
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Course Details</CardTitle>
            <CardDescription>
              All fields are optional except that at least one of working title, source material, or notes must be filled in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Generation failed</AlertTitle>
                <AlertDescription>
                  <p className="mb-3">{(error as Error)?.message ?? "Something went wrong while generating this course."}</p>
                  <Button size="sm" variant="outline" onClick={() => reset()}>Try Again</Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label className="text-[13px]">What do you want to create?</Label>
              <Select value={form.generationMode} onValueChange={v => field("generationMode", v as WizardFormState["generationMode"])}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="course">One individual course</SelectItem>
                  <SelectItem value="training_plan">Multi-course training plan</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.generationMode === "training_plan" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-lg border bg-muted/30 p-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-[13px]">Plan Name</Label>
                  <Input value={form.planName} onChange={e => field("planName", e.target.value)} placeholder="New Hire Onboarding Path" className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]"># Courses</Label>
                  <Input type="number" min="2" value={form.courseCount} onChange={e => field("courseCount", e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <Label className="text-[13px]">Owning Organization *</Label>
                  <Select value={form.organizationId} onValueChange={v => field("organizationId", v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Choose organization" /></SelectTrigger>
                    <SelectContent>
                      {(organizations ?? []).map(org => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Courses are created in the system catalog, then bundled into this organization's training plan.</p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[13px]">Working Title / Topic</Label>
              <Input
                value={form.titleHint}
                onChange={e => field("titleHint", e.target.value)}
                placeholder="Fall Prevention Basics"
                className="h-9"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Category</Label>
                <Input value={form.category} onChange={e => field("category", e.target.value)} placeholder="Annual In-Service" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Training Requirement Type</Label>
                <Select value={form.trainingTypeId} onValueChange={v => field("trainingTypeId", v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TRAINING_TYPE}>Not linked to a compliance requirement</SelectItem>
                    {(trainingTypes ?? []).map(tt => (
                      <SelectItem key={tt.id} value={tt.id}>{tt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Linking a training type also feeds its name, description, and any citation notes on file into the
              prompt as extra grounding context.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Desired Module Count</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.desiredModuleCount}
                  onChange={e => field("desiredModuleCount", e.target.value)}
                  placeholder="e.g. 5"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Desired Duration (minutes)</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.desiredDurationMinutes}
                  onChange={e => field("desiredDurationMinutes", e.target.value)}
                  placeholder="e.g. 45"
                  className="h-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">Source Material</Label>
              <Textarea
                value={form.sourceMaterial}
                onChange={e => field("sourceMaterial", e.target.value)}
                placeholder="Paste the relevant policy, regulation, or reference text you want this course grounded in. The more specific, the less the AI has to guess."
                rows={8}
              />
              <p className="text-xs text-muted-foreground">
                Strongly recommended. Claude is instructed to ground every factual claim in this text and to flag
                uncertainty rather than invent regulation numbers or specifics when it's left blank.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">Notes / Instructions</Label>
              <Textarea
                value={form.notes}
                onChange={e => field("notes", e.target.value)}
                placeholder="Anything else the AI should know -- tone, audience, what to emphasize or avoid, etc."
                rows={4}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {!isPending && (
        <div className="flex justify-end">
          <Button onClick={handleGenerate} className="shadow-sm">
            <Sparkles className="mr-2 h-4 w-4" /> Generate
          </Button>
        </div>
      )}
    </div>
  );
}
