import { useEffect, useId, useState } from "react";
import { BadgeCheck, Loader2, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import {
  nullableField,
  useGetCourseProviderProfile,
  useUpsertCourseProviderProfile,
} from "@/hooks/useCourseProviderProfiles";
import { facilityDaysUntil, formatDateForDisplay } from "@/lib/dateUtils";

interface ProviderFormState {
  provider_full_name: string;
  professional_title: string;
  credential: string;
  credential_number: string;
  credential_issuing_organization: string;
  credential_expires_on: string;
  course_author: string;
  provider_signature_name: string;
  content_version: string;
  last_clinical_review_date: string;
  reviewed_by: string;
  next_review_due: string;
  regulation_review_date: string;
  review_notes: string;
}

const EMPTY_FORM: ProviderFormState = {
  provider_full_name: "",
  professional_title: "",
  credential: "",
  credential_number: "",
  credential_issuing_organization: "",
  credential_expires_on: "",
  course_author: "",
  provider_signature_name: "",
  content_version: "",
  last_clinical_review_date: "",
  reviewed_by: "",
  next_review_due: "",
  regulation_review_date: "",
  review_notes: "",
};

/**
 * Training-provider and clinical-review record for one course.
 *
 * This is regulatory documentation, printed on the certificate and reproduced in the inspection
 * report. It is deliberately NOT an approval workflow: a course is active or archived on its own
 * status, and an overdue next review surfaces the reminder below rather than withdrawing the
 * course or blocking a learner. Every change here is written to audit_logs by a database trigger.
 */
export function TrainingProviderCard({ courseId, canManage }: { courseId: string; canManage: boolean }) {
  const fieldIds = useId();
  const { toast } = useToast();
  const { data: profile, isLoading, isError, error, refetch } = useGetCourseProviderProfile(courseId);
  const upsert = useUpsertCourseProviderProfile();
  const [form, setForm] = useState<ProviderFormState>(EMPTY_FORM);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    // isError matters as much as isLoading here. On a failed load the query settles with
    // profile undefined, so hydrating would blank every field AND mark the course loaded --
    // after which a successful Retry can no longer fill the form in, and an administrator
    // looking at blanks could save them over the stored regulatory metadata.
    if (isLoading || isError || loadedFor === courseId) return;
    setForm({
      provider_full_name: profile?.provider_full_name ?? "",
      professional_title: profile?.professional_title ?? "",
      credential: profile?.credential ?? "",
      credential_number: profile?.credential_number ?? "",
      credential_issuing_organization: profile?.credential_issuing_organization ?? "",
      credential_expires_on: profile?.credential_expires_on ?? "",
      course_author: profile?.course_author ?? "",
      provider_signature_name: profile?.provider_signature_name ?? "",
      content_version: profile?.content_version ?? "",
      last_clinical_review_date: profile?.last_clinical_review_date ?? "",
      reviewed_by: profile?.reviewed_by ?? "",
      next_review_due: profile?.next_review_due ?? "",
      regulation_review_date: profile?.regulation_review_date ?? "",
      review_notes: profile?.review_notes ?? "",
    });
    setLoadedFor(courseId);
  }, [courseId, isLoading, loadedFor, profile]);

  const set = (key: keyof ProviderFormState) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const reviewOverdueDays = profile?.next_review_due ? facilityDaysUntil(profile.next_review_due) : null;
  const credentialExpiredDays = profile?.credential_expires_on
    ? facilityDaysUntil(profile.credential_expires_on)
    : null;

  const handleSave = () => {
    const trimmedName = form.provider_full_name.trim();
    if (!trimmedName) {
      toast({ title: "Enter the training provider's full name", variant: "destructive" });
      return;
    }
    const signature = nullableField(form.provider_signature_name);
    upsert.mutate(
      {
        course_id: courseId,
        provider_full_name: trimmedName,
        professional_title: nullableField(form.professional_title),
        credential: nullableField(form.credential),
        credential_number: nullableField(form.credential_number),
        credential_issuing_organization: nullableField(form.credential_issuing_organization),
        credential_expires_on: nullableField(form.credential_expires_on),
        course_author: nullableField(form.course_author),
        provider_signature_name: signature,
        // A signature and the moment it was recorded travel together; clearing one clears both,
        // which is what the table's own CHECK constraint requires.
        provider_signature_recorded_at: signature
          ? (profile?.provider_signature_name === signature
              ? profile?.provider_signature_recorded_at ?? new Date().toISOString()
              : new Date().toISOString())
          : null,
        content_version: nullableField(form.content_version),
        last_clinical_review_date: nullableField(form.last_clinical_review_date),
        reviewed_by: nullableField(form.reviewed_by),
        next_review_due: nullableField(form.next_review_due),
        regulation_review_date: nullableField(form.regulation_review_date),
        review_notes: nullableField(form.review_notes),
      },
      {
        onSuccess: () => toast({ title: "Training provider record saved" }),
        onError: (e: Error) =>
          toast({ title: "Could not save the training provider record", description: e.message, variant: "destructive" }),
      },
    );
  };

  if (isError) {
    return (
      <Card>
        <CardContent className="py-6">
          <QueryError what="the training provider record" error={error} onRetry={() => void refetch()} />
        </CardContent>
      </Card>
    );
  }

  const field = (
    key: keyof ProviderFormState,
    label: string,
    type: "text" | "date" = "text",
    help?: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${fieldIds}-${key}`}>{label}</Label>
      <Input
        id={`${fieldIds}-${key}`}
        type={type}
        value={form[key]}
        onChange={(event) => set(key)(event.target.value)}
        disabled={!canManage || isLoading}
      />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <BadgeCheck className="h-5 w-5" />
          Training provider and clinical review
          {profile?.credential && <Badge variant="outline">{profile.credential}</Badge>}
          {reviewOverdueDays !== null && reviewOverdueDays < 0 && (
            <Badge variant="destructive">Review overdue</Badge>
          )}
          {credentialExpiredDays !== null && credentialExpiredDays < 0 && (
            <Badge variant="destructive">Credential expired</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Recorded for regulatory documentation and printed on the certificate. These fields do not gate
          publication, assignment, or completion &mdash; an overdue review shows a badge here, it never
          withdraws an active course or blocks a learner.
          {profile?.updated_at && ` Last saved ${formatDateForDisplay(profile.updated_at)}.`}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {field("provider_full_name", "Provider full name")}
          {field("professional_title", "Professional title")}
          {field("credential", "Credential", "text", "For example CDCES.")}
          {field("credential_number", "Credential number")}
          {field("credential_issuing_organization", "Credential issuing organization")}
          {field("credential_expires_on", "Credential expiration date", "date")}
          {field("course_author", "Course author")}
          {field("provider_signature_name", "Provider signature", "text", "Typed signature; the date and time are stamped when it is saved.")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {field("content_version", "Content version", "text", "For example 2026.1.")}
          {field("reviewed_by", "Reviewed by")}
          {field("last_clinical_review_date", "Last clinical review date", "date")}
          {field("next_review_due", "Next review due", "date")}
          {field("regulation_review_date", "Regulation review date", "date")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldIds}-review_notes`}>Review notes</Label>
          <Textarea
            id={`${fieldIds}-review_notes`}
            rows={3}
            value={form.review_notes}
            onChange={(event) => set("review_notes")(event.target.value)}
            disabled={!canManage || isLoading}
          />
        </div>

        {canManage ? (
          <Button onClick={handleSave} disabled={upsert.isPending || isLoading}>
            {upsert.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {upsert.isPending ? "Saving..." : "Save provider record"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only a platform administrator can edit this record.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
