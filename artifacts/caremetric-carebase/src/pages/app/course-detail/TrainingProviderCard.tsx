import { providerPatchFromForm, providerIntent, PROVIDER_LABELS } from '@/lib/providerPolicyForm';
import type { ProviderPreview } from '../../../../../../supabase/functions/_shared/learningProviderPolicy';
import { useEffect, useId, useRef, useState } from "react";
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
  useGetCourseProviderProfile,
  useCourseProviderPolicy,
} from "@/hooks/useCourseProviderProfiles";
import { facilityDaysUntil, formatDateForDisplay } from "@/lib/dateUtils";

// professional_title, credential, credential_number, credential_issuing_organization and
// credential_expires_on are deliberately absent. The provider's post-nominals belong in the name
// itself -- the certificate prints "name, credential" when both are set, so splitting them states
// the same thing twice -- and a form that offers five more boxes invites somebody to do exactly
// that. The columns remain on course_provider_profiles and are not written from here, so any
// value another course already stored is left untouched rather than blanked on save.
interface ProviderFormState {
  provider_full_name: string;
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
  const [offset, setOffset] = useState(0);
  const policy = useCourseProviderPolicy(courseId, canManage, offset);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ProviderPreview | null>(null);
  const [canApply, setCanApply] = useState(false);
  const [message, setMessage] = useState('');
  const intent = useRef<{ key: string; requestId: string } | null>(null);
  const busy = policy.preview.isPending || policy.apply.isPending || policy.status.isPending;
  const [snapshot, setSnapshot] = useState<typeof policy.context.data>();
  const [form, setForm] = useState<ProviderFormState>(EMPTY_FORM);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => { setPreview(null); setCanApply(false); setSnapshot(undefined); setOffset(0); intent.current = null; }, [courseId]);

  useEffect(() => {
    if (canManage && (!policy.context.data || policy.context.isError || policy.context.isFetching)) return;
    // isError matters as much as isLoading here. On a failed load the query settles with
    // profile undefined, so hydrating would blank every field AND mark the course loaded --
    // after which a successful Retry can no longer fill the form in, and an administrator
    // looking at blanks could save them over the stored regulatory metadata.
    if (isLoading || isError || loadedFor === courseId) return;
    setForm({
      provider_full_name: (canManage ? policy.context.data?.profile?.providerFullName : profile?.provider_full_name) ?? "",
      course_author: (canManage ? policy.context.data?.profile?.courseAuthor : profile?.course_author) ?? "",
      provider_signature_name: (canManage ? policy.context.data?.profile?.signatureName : profile?.provider_signature_name) ?? "",
      content_version: (canManage ? policy.context.data?.profile?.contentVersion : profile?.content_version) ?? "",
      last_clinical_review_date: (canManage ? policy.context.data?.profile?.lastClinicalReviewDate : profile?.last_clinical_review_date) ?? "",
      reviewed_by: (canManage ? policy.context.data?.profile?.reviewedBy : profile?.reviewed_by) ?? "",
      next_review_due: (canManage ? policy.context.data?.profile?.nextReviewDue : profile?.next_review_due) ?? "",
      regulation_review_date: (canManage ? policy.context.data?.profile?.regulationReviewDate : profile?.regulation_review_date) ?? "",
      review_notes: (canManage ? policy.context.data?.profile?.reviewNotes : profile?.review_notes) ?? "",
    });
    setLoadedFor(courseId);
    if (canManage) setSnapshot(policy.context.data);
  }, [courseId, isLoading, isError, loadedFor, profile, canManage, policy.context.data, policy.context.isError, policy.context.isFetching]);

  const set = (key: keyof ProviderFormState) => (value: string) =>
    { setPreview(null); setCanApply(false); setForm((previous) => ({ ...previous, [key]: value })); };

  const reviewOverdueDays = profile?.next_review_due ? facilityDaysUntil(profile.next_review_due) : null;

  const handlePreview = async () => {
    if (!snapshot) return;
    try {
      const patch = providerPatchFromForm(snapshot, form);
      const input = { domain: 'course.provider.v1' as const, operation: 'preview' as const, courseId,
        providerContextRevision: snapshot.providerContextRevision, patch, reason: reason.trim() };
      intent.current = providerIntent(intent.current, input);
      const value = await policy.preview.mutateAsync({ ...input, requestId: intent.current.requestId });
      setPreview(value); setCanApply(true); setMessage('');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not preview provider changes.'); }
  };
  const handleApply = async () => {
    if (!preview || !canApply) return;
    try {
      await policy.apply.mutateAsync(preview);
      setPreview(null); setCanApply(false); setLoadedFor(null); intent.current = null;
      setMessage('Provider documentation saved. Already stamped certificates remain unchanged.');
      toast({ title: 'Training provider record saved' });
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Check the saved command before retrying.'); }
  };
  const recover = async (command: { commandId: string; expectedDigest: string }) => {
    try {
      const value = await policy.status.mutateAsync(command);
      setPreview(value.preview); setCanApply(value.canApplyThisSession);
      setMessage(value.result ? 'This command was already saved. Refresh the record before making another change.'
        : value.canApplyThisSession ? 'This exact reviewed command can still be applied in this session.' : 'This command is unapplied. Refresh and review current values in this session.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not retrieve the saved provider command.'); }
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
        disabled={!canManage || isLoading || busy || !snapshot}
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
          {reviewOverdueDays !== null && reviewOverdueDays < 0 && (
            <Badge variant="destructive">Review overdue</Badge>
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
          {field(
            "provider_full_name",
            "Provider full name",
            "text",
            "Include any post-nominals here, as they should read on the certificate.",
          )}
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
            disabled={!canManage || isLoading || busy || !snapshot}
          />
        </div>

        {canManage ? <div className="space-y-4">
          {policy.context.isError && <QueryError what="the protected provider context" error={policy.context.error} onRetry={() => void policy.context.refetch()} />}
          <Label htmlFor={`${fieldIds}-reason`}>Reason for this course-wide change</Label>
          <Textarea id={`${fieldIds}-reason`} value={reason} disabled={busy} maxLength={500} onChange={e => { setReason(e.target.value); setPreview(null); setCanApply(false); }} />
          <p className="text-xs text-muted-foreground">Use 10–500 characters. Provider metadata affects all versions of this course and invalidates material reviews for its governed AI drafts. These fields record documentation; they do not verify credentials or grant approval.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void handlePreview()} disabled={busy || !snapshot || reason.trim().length < 10}>Preview provider changes</Button>
            <Button variant="outline" disabled={busy} onClick={async () => { await Promise.all([policy.context.refetch(), refetch()]); setLoadedFor(null); setPreview(null); setCanApply(false); intent.current = null; }}>Refresh current record</Button>
          </div>
          {preview && <div className="space-y-2 rounded border p-4" aria-label="Provider change preview">
            <p>Reviewed change: {preview.reason}</p>
            <ul className="list-disc pl-5">{preview.changes.map(change => <li key={change.field}><strong>{PROVIDER_LABELS[change.field]}:</strong> {change.before ?? '(empty)'} → {change.after ?? '(empty)'}</li>)}</ul>
            <p>{preview.impact.versionCount} course versions share this profile. {preview.impact.governedDrafts.filter(d => d.reviewInvalidated).length} current AI material reviews will be invalidated.</p>
            {preview.changes.some(c => c.field === 'providerFullName') && <p>{preview.impact.legacyFallbackCertificates} older certificates still display the live provider name. Their display will follow this change. Stamped certificates keep their issued provider snapshot.</p>}
            <p>Typed-signature timestamp: {preview.signatureTimestampAction === 'record' ? 'recorded by the server when saved' : preview.signatureTimestampAction === 'clear' ? 'cleared with the signature' : 'retained unchanged'}.</p>
            <Button onClick={() => void handleApply()} disabled={busy || !canApply || Date.parse(preview.expiresAt) <= Date.now()}>{policy.apply.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Apply reviewed provider changes</Button>
          </div>}
          {message && <p role="status">{message}</p>}
          <div className="space-y-2">
            <p className="font-medium">Your saved provider commands</p>
            {policy.commands.isError && <QueryError what="saved provider commands" error={policy.commands.error} onRetry={() => void policy.commands.refetch()} />}
            {policy.commands.data?.items.map(command => <Button key={command.commandId} variant="outline" disabled={busy} onClick={() => void recover(command)}>Check {command.commandId.slice(0, 8)} — {command.appliedAt ? 'saved' : 'pending'}</Button>)}
            {offset > 0 && <Button variant="outline" onClick={() => setOffset(Math.max(0, offset - 20))}>Previous commands</Button>}
            {policy.commands.data?.nextOffset !== null && policy.commands.data?.nextOffset !== undefined && <Button variant="outline" onClick={() => setOffset(policy.commands.data!.nextOffset!)}>Next commands</Button>}
          </div>
        </div> : <p className="text-xs text-muted-foreground">Only a platform administrator can edit this record.</p>}

      </CardContent>
    </Card>
  );
}
