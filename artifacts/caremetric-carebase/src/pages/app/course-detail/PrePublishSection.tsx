import { CheckCircle2, CircleAlert, Eye, Sparkles } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { CourseBlock, CourseVersion } from "@/hooks/useCourses";

interface PrePublishCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export function PrePublishSection({
  canManage,
  needsAiReview,
  reviewChecked,
  setReviewChecked,
  markingReviewed,
  onMarkReviewed,
  selectedVersion,
  onPreviewAsStudent,
  blocks,
  prePublishChecks,
  publishIssues,
  studentPreviewChecked,
  setStudentPreviewChecked,
}: {
  canManage: boolean;
  needsAiReview: boolean;
  reviewChecked: boolean;
  setReviewChecked: (checked: boolean) => void;
  markingReviewed: boolean;
  onMarkReviewed: () => void;
  selectedVersion: CourseVersion | undefined;
  onPreviewAsStudent: () => void;
  blocks: CourseBlock[] | undefined;
  prePublishChecks: PrePublishCheck[];
  publishIssues: string[] | undefined;
  studentPreviewChecked: boolean;
  setStudentPreviewChecked: (checked: boolean) => void;
}) {
  return (
    <>
      {canManage && needsAiReview && (
        <Alert className="border-warning/40 bg-warning/10">
          <Sparkles className="h-4 w-4" />
          <AlertTitle>AI-generated content needs review</AlertTitle>
          <AlertDescription>
            <p className="mb-3">
              This version's content was drafted by AI and hasn't been reviewed yet. Read through each block below
              for accuracy before publishing -- AI-authored regulatory or policy content can be wrong or outdated.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ai-reviewed-checkbox"
                  checked={reviewChecked}
                  onCheckedChange={c => setReviewChecked(c === true)}
                />
                <Label htmlFor="ai-reviewed-checkbox" className="text-sm font-normal cursor-pointer">
                  I've reviewed this content for accuracy
                </Label>
              </div>
              <Button size="sm" disabled={!reviewChecked || markingReviewed} onClick={onMarkReviewed}>
                {markingReviewed ? "Marking..." : "Mark Reviewed"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {canManage && selectedVersion && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle>Pre-Publish Checklist</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={onPreviewAsStudent}
                disabled={!blocks || blocks.length === 0}
              >
                <Eye className="mr-2 h-3.5 w-3.5" /> Preview as Student
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {prePublishChecks.map(check => {
                const Icon = check.passed ? CheckCircle2 : CircleAlert;
                return (
                  <div key={check.label} className="flex items-start gap-2 rounded-md border p-3">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${check.passed ? "text-success" : "text-warning"}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{check.label}</p>
                      <p className="text-xs text-muted-foreground">{check.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {(publishIssues ?? []).length > 0 && (
              <Alert className="border-warning/40 bg-warning/10">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>Publish blockers</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                    {(publishIssues ?? []).slice(0, 6).map(issue => <li key={issue}>{issue}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="student-preview-reviewed"
                checked={studentPreviewChecked}
                onCheckedChange={checked => setStudentPreviewChecked(checked === true)}
              />
              <Label htmlFor="student-preview-reviewed" className="text-sm font-normal cursor-pointer">
                I reviewed the student preview on an employee-sized screen
              </Label>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
