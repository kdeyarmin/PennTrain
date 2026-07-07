import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetResident } from "@/hooks/useResidents";
import { useListFacilities } from "@/hooks/useFacilities";
import {
  useGetResidentAssessmentForm, useSaveResidentAssessmentFormDraft, useFinalizeResidentAssessmentForm,
  useGenerateResidentAssessmentFormPdf,
} from "@/hooks/useResidentAssessmentForms";
import { useListResidentDocuments } from "@/hooks/useResidentDocuments";
import {
  ADL_ITEMS, SENSORY_ITEMS, SOCIAL_ITEMS, behavioralItems, responsiblePartyOptions,
  createEmptyContent, mergeContentWithDefaults, isDegreeItemRated, isSimpleNeedAddressed, applyPatchToAll,
  CARE_DEGREE_OPTIONS, BEHAVIORAL_DEGREE_OPTIONS, FREQUENCY_OPTIONS, REASON_OPTIONS,
  COPY_PROVIDED_OPTIONS, NO_SIGNATURE_REASON_OPTIONS, RELATIONSHIP_OPTIONS, ASSESSOR_TITLE_OPTIONS,
  emptyDiagnosisRow, emptyParticipantRow,
  type ResidentAssessmentFormContent, type DegreeItemAnswer, type SimpleNeedAnswer, type DiagnosisRow, type ParticipantRow,
  type FormType, type SectionItem, type FacilityCareDefaults,
} from "@/lib/residentAssessmentFormSchema";
import { getComplianceFormLabel } from "@/lib/residentCompliance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Plus, Trash2, Lock, CheckCircle2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const AUTOSAVE_DEBOUNCE_MS = 1500;

function DegreeSelect({ formType, value, allOtherValue, onChange, onAllOtherChange, scale }: {
  formType: FormType; value: string; allOtherValue: string;
  onChange: (v: string) => void; onAllOtherChange: (v: string) => void;
  scale: { value: string; label: string }[];
}) {
  if (formType === "ASP") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[11px] text-muted-foreground">Preliminary</Label>
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Degree" /></SelectTrigger>
            <SelectContent>{scale.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">All Other</Label>
          <Select value={allOtherValue} onValueChange={onAllOtherChange}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Degree" /></SelectTrigger>
            <SelectContent>{scale.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
    );
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="Degree" /></SelectTrigger>
      <SelectContent>{scale.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

// A Select that always resets to its placeholder after a pick -- it exists to drop a common value
// into a plain-text field the user can still hand-edit afterward, not to represent that field's
// current state (unlike every other Select in this file, which is bound to the field it controls).
function QuickFillSelect({ options, onPick, placeholder, className, disabled }: {
  options: { value: string; label: string }[]; onPick: (v: string) => void; placeholder: string; className?: string; disabled?: boolean;
}) {
  return (
    <Select value="" onValueChange={onPick} disabled={disabled}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

// Most residents share the same degree rating or the same plan frequency/responsible party across
// nearly every item in a 22-item (or 11/12-item) list -- filling each one by hand is the single
// biggest source of repetitive clicking in this form. These bars set a value once and apply it to
// every item in the list below them; the assessor then only needs to touch the exceptions. They
// always reset after applying (like QuickFillSelect) since they're a one-shot action, not a control
// bound to any single item's state.
function BulkDegreeBar({ formType, scale, onApply }: {
  formType: FormType; scale: { value: string; label: string }[];
  onApply: (patch: { degree?: string; degreeAllOther?: string }) => void;
}) {
  const [value, setValue] = useState("");
  const [allOtherValue, setAllOtherValue] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-2 bg-muted/40">
      <p className="text-xs text-muted-foreground w-full sm:w-auto sm:mr-1">Set degree for all, then adjust exceptions:</p>
      <DegreeSelect formType={formType} value={value} allOtherValue={allOtherValue} onChange={setValue} onAllOtherChange={setAllOtherValue} scale={scale} />
      <Button
        type="button" variant="secondary" size="sm" disabled={!value && !allOtherValue}
        onClick={() => {
          onApply({ degree: value || undefined, degreeAllOther: allOtherValue || undefined });
          setValue(""); setAllOtherValue("");
        }}
      >
        Apply to All
      </Button>
    </div>
  );
}

// The Frequency/Responsible-Party pair with their "Other" reveals -- identical across every plan
// (ADL items, sensory/social items, diagnosis rows, and the bulk-fill bar), just with different
// value/onChange wiring. One shared component instead of four hand-rolled copies means a future
// change (a new responsible-party code, different "Other" wording) only needs one edit.
function FrequencyPartyFields({
  formType, frequency, frequencyOther, responsibleParty, responsiblePartyOther,
  onFrequencyChange, onFrequencyOtherChange, onPartyChange, onPartyOtherChange, disabled,
}: {
  formType: FormType;
  frequency: string; frequencyOther: string; responsibleParty: string; responsiblePartyOther: string;
  onFrequencyChange: (v: string) => void; onFrequencyOtherChange: (v: string) => void;
  onPartyChange: (v: string) => void; onPartyOtherChange: (v: string) => void;
  disabled?: boolean;
}) {
  const partyOptions = responsiblePartyOptions(formType);
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Select value={frequency} onValueChange={onFrequencyChange} disabled={disabled}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Frequency" /></SelectTrigger>
          <SelectContent>{FREQUENCY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        {frequency === "other" && (
          <Input placeholder="Specify frequency" className="h-8 text-xs" value={frequencyOther} disabled={disabled}
            onChange={(e) => onFrequencyOtherChange(e.target.value)} />
        )}
      </div>
      <div className="space-y-1">
        <Select value={responsibleParty} onValueChange={onPartyChange} disabled={disabled}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Responsible party" /></SelectTrigger>
          <SelectContent>{partyOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        {responsibleParty === "O" && (
          <Input placeholder="Specify responsible party" className="h-8 text-xs" value={responsiblePartyOther} disabled={disabled}
            onChange={(e) => onPartyOtherChange(e.target.value)} />
        )}
      </div>
    </div>
  );
}

function BulkPlanBar({ formType, onApply }: {
  formType: FormType;
  onApply: (patch: {
    planFrequency?: string; planFrequencyOther?: string;
    planResponsibleParty?: string; planResponsiblePartyOther?: string;
  }) => void;
}) {
  const [frequency, setFrequency] = useState("");
  const [frequencyOther, setFrequencyOther] = useState("");
  const [party, setParty] = useState("");
  const [partyOther, setPartyOther] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-2 bg-muted/40">
      <p className="text-xs text-muted-foreground w-full sm:w-auto sm:mr-1">Set plan frequency/party for all, then adjust exceptions:</p>
      <FrequencyPartyFields
        formType={formType}
        frequency={frequency} frequencyOther={frequencyOther} responsibleParty={party} responsiblePartyOther={partyOther}
        onFrequencyChange={setFrequency} onFrequencyOtherChange={setFrequencyOther}
        onPartyChange={setParty} onPartyOtherChange={setPartyOther}
      />
      <Button
        type="button" variant="secondary" size="sm" disabled={!frequency && !party}
        onClick={() => {
          onApply({
            planFrequency: frequency || undefined,
            planFrequencyOther: frequency === "other" ? frequencyOther : undefined,
            planResponsibleParty: party || undefined,
            planResponsiblePartyOther: party === "O" ? partyOther : undefined,
          });
          setFrequency(""); setFrequencyOther(""); setParty(""); setPartyOther("");
        }}
      >
        Apply to All
      </Button>
    </div>
  );
}

function DegreeItemEditor({ item, formType, answer, onChange, scale, readOnly }: {
  item: SectionItem; formType: FormType; answer: DegreeItemAnswer;
  onChange: (next: DegreeItemAnswer) => void; scale: { value: string; label: string }[]; readOnly: boolean;
}) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-medium">{item.label}</p>
        <fieldset disabled={readOnly}>
          <DegreeSelect
            formType={formType}
            value={answer.degree} allOtherValue={answer.degreeAllOther}
            onChange={(v) => onChange({ ...answer, degree: v, degreePreliminary: v })}
            onAllOtherChange={(v) => onChange({ ...answer, degreeAllOther: v })}
            scale={scale}
          />
        </fieldset>
      </div>
      <fieldset disabled={readOnly} className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={answer.serviceNeedNotApplicable}
              onCheckedChange={(c) => onChange({ ...answer, serviceNeedNotApplicable: !!c })}
            />
            <Label className="text-xs">Assessment: not applicable</Label>
          </div>
          {!answer.serviceNeedNotApplicable && (
            <Textarea
              placeholder="Service need description"
              className="text-xs min-h-16"
              value={answer.serviceNeedDescription}
              onChange={(e) => onChange({ ...answer, serviceNeedDescription: e.target.value })}
            />
          )}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={answer.planNotApplicable}
              onCheckedChange={(c) => onChange({ ...answer, planNotApplicable: !!c })}
            />
            <Label className="text-xs">Support plan: not applicable</Label>
          </div>
          {!answer.planNotApplicable && (
            <>
              <Textarea
                placeholder="Plan to meet the need"
                className="text-xs min-h-16"
                value={answer.planDescription}
                onChange={(e) => onChange({ ...answer, planDescription: e.target.value })}
              />
              <FrequencyPartyFields
                formType={formType}
                frequency={answer.planFrequency} frequencyOther={answer.planFrequencyOther}
                responsibleParty={answer.planResponsibleParty} responsiblePartyOther={answer.planResponsiblePartyOther}
                onFrequencyChange={(v) => onChange({ ...answer, planFrequency: v })}
                onFrequencyOtherChange={(v) => onChange({ ...answer, planFrequencyOther: v })}
                onPartyChange={(v) => onChange({ ...answer, planResponsibleParty: v })}
                onPartyOtherChange={(v) => onChange({ ...answer, planResponsiblePartyOther: v })}
              />
            </>
          )}
        </div>
      </fieldset>
    </div>
  );
}

function SimpleNeedEditor({ item, formType, answer, onChange, readOnly }: {
  item: SectionItem; formType: FormType; answer: SimpleNeedAnswer; onChange: (next: SimpleNeedAnswer) => void; readOnly: boolean;
}) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{item.label}</p>
        <fieldset disabled={readOnly} className="flex items-center gap-1.5">
          <Checkbox checked={answer.applicable} onCheckedChange={(c) => onChange({ ...answer, applicable: !!c })} />
          <Label className="text-xs">Applicable</Label>
        </fieldset>
      </div>
      {answer.applicable && (
        <fieldset disabled={readOnly} className="space-y-2">
          <Textarea
            placeholder="Description"
            className="text-xs min-h-14"
            value={answer.description}
            onChange={(e) => onChange({ ...answer, description: e.target.value })}
          />
          <Textarea
            placeholder="Plan to meet the need"
            className="text-xs min-h-14"
            value={answer.planDescription}
            onChange={(e) => onChange({ ...answer, planDescription: e.target.value })}
          />
          <FrequencyPartyFields
            formType={formType}
            frequency={answer.planFrequency} frequencyOther={answer.planFrequencyOther}
            responsibleParty={answer.planResponsibleParty} responsiblePartyOther={answer.planResponsiblePartyOther}
            onFrequencyChange={(v) => onChange({ ...answer, planFrequency: v })}
            onFrequencyOtherChange={(v) => onChange({ ...answer, planFrequencyOther: v })}
            onPartyChange={(v) => onChange({ ...answer, planResponsibleParty: v })}
            onPartyOtherChange={(v) => onChange({ ...answer, planResponsiblePartyOther: v })}
          />
        </fieldset>
      )}
    </div>
  );
}

interface ReviewCheckItem {
  label: string;
  ok: boolean;
  detail?: string;
}

function ReviewChecklistRow({ item }: { item: ReviewCheckItem }) {
  return (
    <div className="flex items-start gap-2 py-2">
      {item.ok
        ? <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
        : <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />}
      <div>
        <p className="text-sm">{item.label}</p>
        {!item.ok && item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
      </div>
    </div>
  );
}

function DiagnosisRowsEditor({ title, rows, noneChecked, onRowsChange, onNoneChange, readOnly, maxRows, formType, planDefaults }: {
  title: string; rows: DiagnosisRow[]; noneChecked: boolean;
  onRowsChange: (rows: DiagnosisRow[]) => void; onNoneChange: (v: boolean) => void; readOnly: boolean; maxRows: number; formType: FormType;
  planDefaults?: FacilityCareDefaults;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        <fieldset disabled={readOnly} className="flex items-center gap-1.5">
          <Checkbox checked={noneChecked} onCheckedChange={(c) => onNoneChange(!!c)} />
          <Label className="text-xs">None</Label>
        </fieldset>
      </div>
      {!noneChecked && (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const updateRow = (patch: Partial<DiagnosisRow>) => onRowsChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
            return (
            <div key={i} className="border rounded-lg p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Description"
                  className="h-8 text-xs"
                  value={row.description}
                  disabled={readOnly}
                  onChange={(e) => updateRow({ description: e.target.value })}
                />
                {!readOnly && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onRowsChange(rows.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
              <Input
                placeholder="Plan to meet the need"
                className="h-8 text-xs"
                value={row.planDescription}
                disabled={readOnly}
                onChange={(e) => updateRow({ planDescription: e.target.value })}
              />
              <FrequencyPartyFields
                formType={formType} disabled={readOnly}
                frequency={row.planFrequency} frequencyOther={row.planFrequencyOther}
                responsibleParty={row.planResponsibleParty} responsiblePartyOther={row.planResponsiblePartyOther}
                onFrequencyChange={(v) => updateRow({ planFrequency: v })}
                onFrequencyOtherChange={(v) => updateRow({ planFrequencyOther: v })}
                onPartyChange={(v) => updateRow({ planResponsibleParty: v })}
                onPartyOtherChange={(v) => updateRow({ planResponsiblePartyOther: v })}
              />
            </div>
            );
          })}
          {!readOnly && rows.length < maxRows && (
            <Button
              variant="outline" size="sm"
              onClick={() => onRowsChange([...rows, {
                ...emptyDiagnosisRow(),
                ...(planDefaults?.responsibleParty ? { planResponsibleParty: planDefaults.responsibleParty } : {}),
                ...(planDefaults?.frequency ? { planFrequency: planDefaults.frequency } : {}),
              }])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Row
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ResidentAssessmentFormEditor() {
  const { residentId, formId } = useParams<{ residentId: string; formId: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: resident } = useGetResident(residentId);
  const { data: facilities } = useListFacilities();
  const { data: form, isLoading } = useGetResidentAssessmentForm(formId);
  const { data: residentDocuments } = useListResidentDocuments(residentId);
  const saveDraft = useSaveResidentAssessmentFormDraft();
  const finalize = useFinalizeResidentAssessmentForm();
  const generatePdf = useGenerateResidentAssessmentFormPdf();

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const facility = facilities?.find((f) => f.id === resident?.facility_id);
  const formLabel = getComplianceFormLabel(facility?.facility_type);

  const [content, setContent] = useState<ResidentAssessmentFormContent | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ id: string; content: ResidentAssessmentFormContent } | null>(null);
  const isReadOnly = !canManage || form?.status === "finalized";

  useEffect(() => {
    if (!form) return;
    // A brand-new form's content is a bare {} (see start_resident_assessment_form()'s
    // coalesce(v_prior.content, '{}'::jsonb)) -- deep-merge onto the full default shape so every
    // section, including item maps that may have grown new keys since this form's schema_version,
    // has its expected keys. A revised form's content already carries the full shape forward from
    // the prior version under the same schema_version, so the merge is a no-op for those.
    //
    // Deliberately keyed only on form?.id, not on facility -- this must run exactly once per form.
    // The facility's default care-team fields are read from whatever's already loaded in this
    // closure at that moment: if the facilities list hasn't resolved yet, the new form simply
    // starts without defaults (the bulk-fill toolbars are still available as a fallback). Widening
    // this to also depend on facility fields previously caused the effect to fire a second time
    // once the facilities/resident queries resolved, silently discarding any edits already made in
    // that window (it rebuilds from the stale form.content snapshot, not live state) -- and if that
    // query ever errors instead of resolving, the effect would never fire at all, leaving the whole
    // editor stuck on the loading skeleton.
    setContent(mergeContentWithDefaults(
      createEmptyContent(form.form_type as FormType, {
        responsibleParty: facility?.default_care_responsible_party,
        frequency: facility?.default_care_frequency,
      }),
      form.content,
    ));
  }, [form?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: ResidentAssessmentFormContent) => {
    setContent(next);
    if (isReadOnly || !formId) return;
    pendingSave.current = { id: formId, content: next };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      pendingSave.current = null;
      saveDraft.mutate(
        { id: formId, content: next },
        {
          // A failed autosave (e.g. someone else finalized this form in another tab, so RLS now
          // rejects the update since it's no longer a draft) used to fail completely silently --
          // the user would keep editing a form that was never actually being saved, with no
          // indication anything was wrong until they navigated away and lost the changes.
          onError: (e: Error) => toast({ title: "Failed to save changes", description: e.message, variant: "destructive" }),
        },
      );
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  // Navigating away (e.g. "Back to Resident") within the debounce window used to just cancel the
  // scheduled save and drop those edits silently -- there's no separate manual Save button, so the
  // debounced autosave is the only path those changes had. Flush whatever's pending instead of
  // discarding it; the mutation still completes even though the component has unmounted.
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      if (pendingSave.current) saveDraft.mutate(pendingSave.current);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const behavioralList = useMemo(() => behavioralItems((form?.form_type as FormType) ?? "RASP"), [form?.form_type]);

  // Memoized on the specific item maps (not the whole `content` object, which changes on every
  // keystroke anywhere in the form) so typing in an unrelated field doesn't re-filter these lists;
  // rated counts (below, after the loading guard) are derived from these unrated lists rather than
  // re-filtered separately, so the tab badge and the Review tab's named gaps can't drift out of
  // sync with each other. Guarded on `content` since it's still null before the initial-content
  // effect runs -- these hooks must stay above the loading-guard's early return either way.
  const unratedAdlItems = useMemo(
    () => (content ? ADL_ITEMS.filter((item) => !isDegreeItemRated((form?.form_type as FormType) ?? "RASP", content.section1.items[item.key])) : []),
    [form?.form_type, content?.section1.items],
  );
  const unratedBehavioralItems = useMemo(
    () => (content ? behavioralList.filter((item) => !isDegreeItemRated((form?.form_type as FormType) ?? "RASP", content.section3.items[item.key])) : []),
    [form?.form_type, behavioralList, content?.section3.items],
  );
  const unratedCareLevels = useMemo(
    () => (content ? (["supervision", "mobility", "medications"] as const).filter((key) => !content.section1[key].level) : []),
    [content?.section1],
  );
  const unaddressedSensoryItems = useMemo(
    () => (content ? SENSORY_ITEMS.filter((item) => !isSimpleNeedAddressed(content.section2.sensory[item.key])) : []),
    [content?.section2.sensory],
  );
  const unaddressedSocialItems = useMemo(
    () => (content ? SOCIAL_ITEMS.filter((item) => !isSimpleNeedAddressed(content.section4.items[item.key])) : []),
    [content?.section4.items],
  );

  const handleFinalize = async () => {
    if (!formId || !content) return;
    // finalize_resident_assessment_form() doesn't take content as an argument -- it finalizes
    // whatever's already persisted. If the user clicks Finalize within the debounce window, flush
    // the pending autosave first so the locked version matches what's on screen, not a stale one.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingSave.current = null;
      try {
        await saveDraft.mutateAsync({ id: formId, content });
      } catch (e) {
        toast({ title: "Failed to save latest changes before finalizing", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
        return;
      }
    }
    finalize.mutate(formId, {
      onSuccess: () => toast({ title: `${formLabel} finalized and saved as a PDF` }),
      onError: (e: Error) => toast({ title: "Failed to finalize", description: e.message, variant: "destructive" }),
    });
  };

  if (isLoading || !content || !form) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const formType = form.form_type as FormType;
  const degreeScale = CARE_DEGREE_OPTIONS;
  // Same facility defaults createEmptyContent uses for brand-new forms, reused so a diagnosis row
  // added later via "Add Row" isn't the one place in the form that comes up without them.
  const facilityPlanDefaults = { responsibleParty: facility?.default_care_responsible_party, frequency: facility?.default_care_frequency };
  // generate-resident-assessment-pdf/index.ts refuses (409) once a resident_documents row with this
  // form's document_label exists -- it's a one-shot "finalize succeeded but PDF generation failed"
  // retry, not a true regenerate. Only offer the button while that row is still missing, otherwise
  // it's guaranteed to fail.
  const hasGeneratedPdf = (residentDocuments ?? []).some((d) => d.document_label === `resident_assessment_form:${form.id}`);
  const adlRatedCount = ADL_ITEMS.length - unratedAdlItems.length;
  const behavioralRatedCount = behavioralList.length - unratedBehavioralItems.length;

  // A condensed pre-finalize checklist -- named gaps (not just counts), so catching a missed item
  // doesn't require tab-hopping through all six tabs. Deliberately checks presence/completeness
  // signals only (not content quality), since this can't judge whether an answer is *correct*.
  const reviewChecklist: ReviewCheckItem[] = [
    { label: "Reason for Assessment selected", ok: !!content.assessmentInfo.assessmentReason },
    { label: "Reason for Support Plan selected", ok: !!content.assessmentInfo.supportPlanReason },
    {
      label: "Supervision, Mobility, and Medications degrees rated",
      ok: unratedCareLevels.length === 0,
      detail: unratedCareLevels.length ? `Still needs a degree: ${unratedCareLevels.map((k) => k[0].toUpperCase() + k.slice(1)).join(", ")}` : undefined,
    },
    {
      label: `All ${ADL_ITEMS.length} Personal Care Needs items rated`,
      ok: unratedAdlItems.length === 0,
      detail: unratedAdlItems.length ? `Still needs a degree: ${unratedAdlItems.map((i) => i.label).join(", ")}` : undefined,
    },
    { label: "Physical medical diagnoses addressed (rows added, or \"None\" checked)", ok: content.section2.noPhysicalDiagnoses || content.section2.physicalDiagnoses.length > 0 },
    { label: "Dental needs addressed", ok: content.section2.noDental || content.section2.dental.length > 0 },
    { label: "Dietary needs addressed", ok: content.section2.noDietary || content.section2.dietary.length > 0 },
    {
      label: `All ${SENSORY_ITEMS.length} Sensory Needs items addressed`,
      ok: unaddressedSensoryItems.length === 0,
      detail: unaddressedSensoryItems.length ? `Still needs a description or "not applicable": ${unaddressedSensoryItems.map((i) => i.label).join(", ")}` : undefined,
    },
    { label: "Psychological diagnoses addressed", ok: content.section3.noPsychologicalDiagnoses || content.section3.psychologicalDiagnoses.length > 0 },
    {
      label: `All ${behavioralList.length} Behavioral/Cognitive items rated`,
      ok: unratedBehavioralItems.length === 0,
      detail: unratedBehavioralItems.length ? `Still needs a degree: ${unratedBehavioralItems.map((i) => i.label).join(", ")}` : undefined,
    },
    {
      label: `All ${SOCIAL_ITEMS.length} Social and Recreational items addressed`,
      ok: unaddressedSocialItems.length === 0,
      detail: unaddressedSocialItems.length ? `Still needs a description or "not applicable": ${unaddressedSocialItems.map((i) => i.label).join(", ")}` : undefined,
    },
    { label: "Overall Wellness Summary written", ok: !!content.summary.overallWellness.trim() },
    {
      label: "Assessor name, title, and signed date recorded",
      ok: !!content.participation.assessorName.trim() && !!content.participation.assessorTitle.trim() && !!content.participation.assessorSignedDate,
    },
    { label: "At least one participant recorded", ok: content.participation.participants.length > 0 },
  ];
  const reviewIncompleteCount = reviewChecklist.filter((c) => !c.ok).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/app/residents/${residentId}`}><ArrowLeft className="mr-2 h-4 w-4" /> Back to Resident</Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              {formLabel} — v{form.version_number}
              {form.status === "finalized" && <Badge variant="outline"><Lock className="mr-1 h-3 w-3" /> Finalized</Badge>}
              {form.status === "draft" && <Badge variant="outline">Draft</Badge>}
            </h1>
            <p className="text-sm text-muted-foreground">
              {resident?.last_name}, {resident?.first_name} · {facility?.name}
            </p>
          </div>
        </div>
        {!isReadOnly && (
          <Button onClick={handleFinalize} disabled={finalize.isPending || saveDraft.isPending}>
            {finalize.isPending || saveDraft.isPending ? "Finalizing..." : `Finalize ${formLabel}`}
          </Button>
        )}
        {canManage && form.status === "finalized" && !hasGeneratedPdf && (
          <Button
            variant="outline"
            disabled={generatePdf.isPending}
            onClick={() => generatePdf.mutate(formId!, {
              onSuccess: () => toast({ title: `${formLabel} PDF generated` }),
              onError: (e: Error) => toast({ title: "Failed to generate PDF", description: e.message, variant: "destructive" }),
            })}
          >
            {generatePdf.isPending ? "Generating..." : "Generate PDF"}
          </Button>
        )}
      </div>

      <Tabs defaultValue="info">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="info">Resident &amp; Assessment Info</TabsTrigger>
          <TabsTrigger value="section1">
            Personal Care, Supervision, Mobility, Meds
            {adlRatedCount < ADL_ITEMS.length && <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{adlRatedCount}/{ADL_ITEMS.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="section2">Medical, Dental, Dietary, Sensory</TabsTrigger>
          <TabsTrigger value="section3">
            Mental / Behavioral / Cognitive
            {behavioralRatedCount < behavioralList.length && <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{behavioralRatedCount}/{behavioralList.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="section4">Social &amp; Recreational</TabsTrigger>
          <TabsTrigger value="summary">Summary &amp; Participation</TabsTrigger>
          <TabsTrigger value="review">
            Review
            {reviewIncompleteCount > 0 && <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{reviewIncompleteCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Part I &amp; II — Resident and Assessment Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Facility, resident, and preparer identifying info is pulled automatically from your
                CareMetric records at print time — nothing here duplicates it.
              </p>
              <fieldset disabled={isReadOnly} className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Reason for Assessment</Label>
                  <Select
                    value={content.assessmentInfo.assessmentReason}
                    onValueChange={(v) => update({ ...content, assessmentInfo: { ...content.assessmentInfo, assessmentReason: v as typeof content.assessmentInfo.assessmentReason } })}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select reason" /></SelectTrigger>
                    <SelectContent>{REASON_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reason for Support Plan</Label>
                  <Select
                    value={content.assessmentInfo.supportPlanReason}
                    onValueChange={(v) => update({ ...content, assessmentInfo: { ...content.assessmentInfo, supportPlanReason: v as typeof content.assessmentInfo.supportPlanReason } })}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select reason" /></SelectTrigger>
                    <SelectContent>{REASON_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Last Assessment Date</Label>
                  <Input type="date" className="h-9" value={content.assessmentInfo.lastAssessmentDate}
                    onChange={(e) => update({ ...content, assessmentInfo: { ...content.assessmentInfo, lastAssessmentDate: e.target.value } })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Last Support Plan Date</Label>
                  <Input type="date" className="h-9" value={content.assessmentInfo.lastSupportPlanDate}
                    onChange={(e) => update({ ...content, assessmentInfo: { ...content.assessmentInfo, lastSupportPlanDate: e.target.value } })} />
                </div>
                {(content.assessmentInfo.assessmentReason === "significant_change" || content.assessmentInfo.supportPlanReason === "significant_change") && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">Description of Significant Change</Label>
                    <Textarea value={content.assessmentInfo.changeDescription}
                      onChange={(e) => update({ ...content, assessmentInfo: { ...content.assessmentInfo, changeDescription: e.target.value } })} />
                  </div>
                )}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Comments or Related Information</Label>
                  <Textarea value={content.residentInfo.comments}
                    onChange={(e) => update({ ...content, residentInfo: { ...content.residentInfo, comments: e.target.value } })} />
                </div>
              </fieldset>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="section1" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Supervision, Mobility, Medications</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <fieldset disabled={isReadOnly} className="grid sm:grid-cols-3 gap-4">
                {(["supervision", "mobility", "medications"] as const).map((key) => {
                  const s = content.section1[key];
                  const updateField = (patch: Partial<typeof s>) => update({ ...content, section1: { ...content.section1, [key]: { ...s, ...patch } } });
                  return (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs capitalize">{key}</Label>
                    <Select value={s.level} onValueChange={(v) => updateField({ level: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Degree" /></SelectTrigger>
                      <SelectContent>{CARE_DEGREE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Textarea
                      placeholder="Description of need"
                      className="min-h-20 text-xs"
                      value={s.needsDescription}
                      onChange={(e) => updateField({ needsDescription: e.target.value })}
                    />
                    <Textarea
                      placeholder="Plan to meet the need"
                      className="min-h-20 text-xs"
                      value={s.planDescription}
                      onChange={(e) => updateField({ planDescription: e.target.value })}
                    />
                    <Select value={s.planResponsibleParty} onValueChange={(v) => updateField({ planResponsibleParty: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Responsible party" /></SelectTrigger>
                      <SelectContent>{responsiblePartyOptions(formType).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                    {s.planResponsibleParty === "O" && (
                      <Input placeholder="Specify responsible party" className="h-8 text-xs" value={s.planResponsiblePartyOther}
                        onChange={(e) => updateField({ planResponsiblePartyOther: e.target.value })} />
                    )}
                  </div>
                  );
                })}
              </fieldset>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Personal Care Needs (22 items)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!isReadOnly && (
                <>
                  <BulkDegreeBar
                    formType={formType} scale={degreeScale}
                    onApply={(patch) => update({
                      ...content,
                      section1: {
                        ...content.section1,
                        // degree/degreePreliminary mirror each other (see DegreeItemEditor's own
                        // onChange) -- applyPatchToAll drops whichever key was left unset, so this
                        // doesn't need its own "only include what changed" guard anymore.
                        items: applyPatchToAll(content.section1.items, { degree: patch.degree, degreePreliminary: patch.degree, degreeAllOther: patch.degreeAllOther }),
                      },
                    })}
                  />
                  <BulkPlanBar
                    formType={formType}
                    onApply={(patch) => update({ ...content, section1: { ...content.section1, items: applyPatchToAll(content.section1.items, patch) } })}
                  />
                </>
              )}
              {ADL_ITEMS.map((item) => (
                <DegreeItemEditor
                  key={item.key} item={item} formType={formType} scale={degreeScale} readOnly={isReadOnly}
                  answer={content.section1.items[item.key]}
                  onChange={(next) => update({ ...content, section1: { ...content.section1, items: { ...content.section1.items, [item.key]: next } } })}
                />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="section2" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Medical &amp; Dental &amp; Dietary Diagnoses</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <DiagnosisRowsEditor
                title="Physical Medical Diagnoses" maxRows={8} readOnly={isReadOnly} formType={formType} planDefaults={facilityPlanDefaults}
                rows={content.section2.physicalDiagnoses} noneChecked={content.section2.noPhysicalDiagnoses}
                onRowsChange={(rows) => update({ ...content, section2: { ...content.section2, physicalDiagnoses: rows } })}
                onNoneChange={(v) => update({ ...content, section2: { ...content.section2, noPhysicalDiagnoses: v } })}
              />
              <DiagnosisRowsEditor
                title="Dental Needs" maxRows={2} readOnly={isReadOnly} formType={formType} planDefaults={facilityPlanDefaults}
                rows={content.section2.dental} noneChecked={content.section2.noDental}
                onRowsChange={(rows) => update({ ...content, section2: { ...content.section2, dental: rows } })}
                onNoneChange={(v) => update({ ...content, section2: { ...content.section2, noDental: v } })}
              />
              <DiagnosisRowsEditor
                title="Dietary Needs" maxRows={2} readOnly={isReadOnly} formType={formType} planDefaults={facilityPlanDefaults}
                rows={content.section2.dietary} noneChecked={content.section2.noDietary}
                onRowsChange={(rows) => update({ ...content, section2: { ...content.section2, dietary: rows } })}
                onNoneChange={(v) => update({ ...content, section2: { ...content.section2, noDietary: v } })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Sensory Needs</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!isReadOnly && (
                <BulkPlanBar
                  formType={formType}
                  onApply={(patch) => update({ ...content, section2: { ...content.section2, sensory: applyPatchToAll(content.section2.sensory, patch) } })}
                />
              )}
              {SENSORY_ITEMS.map((item) => (
                <SimpleNeedEditor
                  key={item.key} item={item} formType={formType} readOnly={isReadOnly}
                  answer={content.section2.sensory[item.key]}
                  onChange={(next) => update({ ...content, section2: { ...content.section2, sensory: { ...content.section2.sensory, [item.key]: next } } })}
                />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="section3" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Psychological Diagnoses</CardTitle></CardHeader>
            <CardContent>
              <DiagnosisRowsEditor
                title="Psychological Medical Diagnoses" maxRows={8} readOnly={isReadOnly} formType={formType} planDefaults={facilityPlanDefaults}
                rows={content.section3.psychologicalDiagnoses} noneChecked={content.section3.noPsychologicalDiagnoses}
                onRowsChange={(rows) => update({ ...content, section3: { ...content.section3, psychologicalDiagnoses: rows } })}
                onNoneChange={(v) => update({ ...content, section3: { ...content.section3, noPsychologicalDiagnoses: v } })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Mental Health, Behavioral Health, Cognitive Functioning</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!isReadOnly && (
                <>
                  <BulkDegreeBar
                    formType={formType} scale={BEHAVIORAL_DEGREE_OPTIONS}
                    onApply={(patch) => update({
                      ...content,
                      section3: {
                        ...content.section3,
                        items: applyPatchToAll(content.section3.items, {
                          ...(patch.degree !== undefined ? { degree: patch.degree, degreePreliminary: patch.degree } : {}),
                          ...(patch.degreeAllOther !== undefined ? { degreeAllOther: patch.degreeAllOther } : {}),
                        }),
                      },
                    })}
                  />
                  <BulkPlanBar
                    formType={formType}
                    onApply={(patch) => update({ ...content, section3: { ...content.section3, items: applyPatchToAll(content.section3.items, patch) } })}
                  />
                </>
              )}
              {behavioralList.map((item) => (
                <DegreeItemEditor
                  key={item.key} item={item} formType={formType} scale={BEHAVIORAL_DEGREE_OPTIONS} readOnly={isReadOnly}
                  answer={content.section3.items[item.key]}
                  onChange={(next) => update({ ...content, section3: { ...content.section3, items: { ...content.section3.items, [item.key]: next } } })}
                />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="section4" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Social and Recreational Needs</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!isReadOnly && (
                <BulkPlanBar
                  formType={formType}
                  onApply={(patch) => update({ ...content, section4: { ...content.section4, items: applyPatchToAll(content.section4.items, patch) } })}
                />
              )}
              {SOCIAL_ITEMS.map((item) => (
                <SimpleNeedEditor
                  key={item.key} item={item} formType={formType} readOnly={isReadOnly}
                  answer={content.section4.items[item.key]}
                  onChange={(next) => update({ ...content, section4: { ...content.section4, items: { ...content.section4.items, [item.key]: next } } })}
                />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Part IV — Summary and Determination</CardTitle></CardHeader>
            <CardContent>
              <fieldset disabled={isReadOnly}>
                <Label className="text-xs">Summary of Resident's Overall Wellness</Label>
                <Textarea
                  className="min-h-28"
                  value={content.summary.overallWellness}
                  onChange={(e) => update({ ...content, summary: { overallWellness: e.target.value } })}
                />
              </fieldset>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Part V — Participation</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <fieldset disabled={isReadOnly} className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Assessor's Printed Name</Label>
                    {!isReadOnly && user && (
                      <Button
                        type="button" variant="link" size="sm" className="h-auto p-0 text-[11px]"
                        onClick={() => update({ ...content, participation: { ...content.participation, assessorName: `${user.firstName} ${user.lastName}`.trim() } })}
                      >
                        Use my name
                      </Button>
                    )}
                  </div>
                  <Input className="h-9" value={content.participation.assessorName}
                    onChange={(e) => update({ ...content, participation: { ...content.participation, assessorName: e.target.value } })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Assessor's Title</Label>
                  <QuickFillSelect
                    className="h-9" placeholder="Quick fill…" options={ASSESSOR_TITLE_OPTIONS}
                    onPick={(v) => update({ ...content, participation: { ...content.participation, assessorTitle: v } })}
                  />
                  <Input className="h-9" placeholder="Title" value={content.participation.assessorTitle}
                    onChange={(e) => update({ ...content, participation: { ...content.participation, assessorTitle: e.target.value } })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date Signed</Label>
                  <Input type="date" className="h-9" value={content.participation.assessorSignedDate}
                    onChange={(e) => update({ ...content, participation: { ...content.participation, assessorSignedDate: e.target.value } })} />
                </div>
              </fieldset>
              <div className="space-y-2">
                <p className="text-sm font-medium">Participants (resident, family, etc.)</p>
                {content.participation.participants.map((p, i) => {
                  const updateParticipant = (patch: Partial<ParticipantRow>) => update({
                    ...content,
                    participation: {
                      ...content.participation,
                      participants: content.participation.participants.map((r, j) => (j === i ? { ...r, ...patch } : r)),
                    },
                  });
                  return (
                  <div key={i} className="border rounded-lg p-2 space-y-2">
                    <div className="grid sm:grid-cols-4 gap-2 items-start">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Name</Label>
                        <Input className="h-8 text-xs" value={p.name} disabled={isReadOnly}
                          onChange={(e) => updateParticipant({ name: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Relationship</Label>
                        <QuickFillSelect
                          className="h-8 text-xs" placeholder="Quick fill…" options={RELATIONSHIP_OPTIONS} disabled={isReadOnly}
                          onPick={(v) => updateParticipant({ relationshipToResident: v })}
                        />
                        <Input className="h-8 text-xs" placeholder="Relationship" value={p.relationshipToResident} disabled={isReadOnly}
                          onChange={(e) => updateParticipant({ relationshipToResident: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Date Signed</Label>
                        <Input type="date" className="h-8 text-xs" value={p.signedDate} disabled={isReadOnly}
                          onChange={(e) => updateParticipant({ signedDate: e.target.value })} />
                      </div>
                      {!isReadOnly && (
                        <div className="flex justify-end">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => update({ ...content, participation: { ...content.participation, participants: content.participation.participants.filter((_, j) => j !== i) } })}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <fieldset disabled={isReadOnly} className="grid sm:grid-cols-3 gap-2 items-end">
                      <div className="flex items-center gap-1.5">
                        <Checkbox checked={!!p.copyRequested} onCheckedChange={(c) => updateParticipant({ copyRequested: !!c })} />
                        <Label className="text-[11px]">Copy Requested</Label>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Copy Provided</Label>
                        <Select value={p.copyProvided || "na"} onValueChange={(v) => updateParticipant({ copyProvided: v as ParticipantRow["copyProvided"] })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Copy provided?" /></SelectTrigger>
                          <SelectContent>{COPY_PROVIDED_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      {!p.signedDate && (
                        <div className="space-y-1">
                          <Label className="text-[11px]">Reason Not Signed</Label>
                          <Select value={p.noSignatureReason || ""} onValueChange={(v) => updateParticipant({ noSignatureReason: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Reason" /></SelectTrigger>
                            <SelectContent>{NO_SIGNATURE_REASON_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                          </Select>
                          {p.noSignatureReason === "other" && (
                            <Input className="h-8 text-xs" placeholder="Specify" value={p.noSignatureReasonOther || ""}
                              onChange={(e) => updateParticipant({ noSignatureReasonOther: e.target.value })} />
                          )}
                        </div>
                      )}
                    </fieldset>
                  </div>
                  );
                })}
                {!isReadOnly && (
                  <Button variant="outline" size="sm" onClick={() => update({ ...content, participation: { ...content.participation, participants: [...content.participation.participants, emptyParticipantRow()] } })}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add Participant
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                <span>Pre-Finalize Review</span>
                {reviewIncompleteCount === 0
                  ? <Badge className="bg-success text-success-foreground hover:bg-success/80">All checks passed</Badge>
                  : <Badge variant="secondary">{reviewIncompleteCount} item{reviewIncompleteCount === 1 ? "" : "s"} to check</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {reviewChecklist.map((item, i) => <ReviewChecklistRow key={i} item={item} />)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
