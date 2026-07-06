import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetResident } from "@/hooks/useResidents";
import { useListFacilities } from "@/hooks/useFacilities";
import {
  useGetResidentAssessmentForm, useSaveResidentAssessmentFormDraft, useFinalizeResidentAssessmentForm,
  useGenerateResidentAssessmentFormPdf,
} from "@/hooks/useResidentAssessmentForms";
import {
  ADL_ITEMS, SENSORY_ITEMS, SOCIAL_ITEMS, behavioralItems, responsiblePartyOptions,
  createEmptyContent, mergeContentWithDefaults,
  CARE_DEGREE_OPTIONS, BEHAVIORAL_DEGREE_OPTIONS, FREQUENCY_OPTIONS, REASON_OPTIONS,
  emptyDiagnosisRow, emptyParticipantRow,
  type ResidentAssessmentFormContent, type DegreeItemAnswer, type SimpleNeedAnswer, type DiagnosisRow, type ParticipantRow,
  type FormType, type SectionItem,
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
import { ArrowLeft, Plus, Trash2, Lock } from "lucide-react";
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

function DegreeItemEditor({ item, formType, answer, onChange, scale, readOnly }: {
  item: SectionItem; formType: FormType; answer: DegreeItemAnswer;
  onChange: (next: DegreeItemAnswer) => void; scale: { value: string; label: string }[]; readOnly: boolean;
}) {
  const partyOptions = responsiblePartyOptions(formType);
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
              <div className="grid grid-cols-2 gap-2">
                <Select value={answer.planFrequency} onValueChange={(v) => onChange({ ...answer, planFrequency: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Frequency" /></SelectTrigger>
                  <SelectContent>{FREQUENCY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={answer.planResponsibleParty} onValueChange={(v) => onChange({ ...answer, planResponsibleParty: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Responsible party" /></SelectTrigger>
                  <SelectContent>{partyOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
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
  const partyOptions = responsiblePartyOptions(formType);
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
          <div className="grid grid-cols-2 gap-2">
            <Select value={answer.planFrequency} onValueChange={(v) => onChange({ ...answer, planFrequency: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Frequency" /></SelectTrigger>
              <SelectContent>{FREQUENCY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={answer.planResponsibleParty} onValueChange={(v) => onChange({ ...answer, planResponsibleParty: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Responsible party" /></SelectTrigger>
              <SelectContent>{partyOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </fieldset>
      )}
    </div>
  );
}

function DiagnosisRowsEditor({ title, rows, noneChecked, onRowsChange, onNoneChange, readOnly, maxRows }: {
  title: string; rows: DiagnosisRow[]; noneChecked: boolean;
  onRowsChange: (rows: DiagnosisRow[]) => void; onNoneChange: (v: boolean) => void; readOnly: boolean; maxRows: number;
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
          {rows.map((row, i) => (
            <div key={i} className="border rounded-lg p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Description"
                  className="h-8 text-xs"
                  value={row.description}
                  disabled={readOnly}
                  onChange={(e) => onRowsChange(rows.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))}
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
                onChange={(e) => onRowsChange(rows.map((r, j) => (j === i ? { ...r, planDescription: e.target.value } : r)))}
              />
            </div>
          ))}
          {!readOnly && rows.length < maxRows && (
            <Button variant="outline" size="sm" onClick={() => onRowsChange([...rows, emptyDiagnosisRow()])}>
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
    setContent(mergeContentWithDefaults(createEmptyContent(form.form_type as FormType), form.content));
  }, [form?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: ResidentAssessmentFormContent) => {
    setContent(next);
    if (isReadOnly || !formId) return;
    pendingSave.current = { id: formId, content: next };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      pendingSave.current = null;
      saveDraft.mutate({ id: formId, content: next });
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
        {canManage && form.status === "finalized" && (
          <Button
            variant="outline"
            disabled={generatePdf.isPending}
            onClick={() => generatePdf.mutate(formId!, {
              onSuccess: () => toast({ title: `${formLabel} PDF generated` }),
              onError: (e: Error) => toast({ title: "Failed to generate PDF", description: e.message, variant: "destructive" }),
            })}
          >
            {generatePdf.isPending ? "Generating..." : "Regenerate PDF"}
          </Button>
        )}
      </div>

      <Tabs defaultValue="info">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="info">Resident &amp; Assessment Info</TabsTrigger>
          <TabsTrigger value="section1">Personal Care, Supervision, Mobility, Meds</TabsTrigger>
          <TabsTrigger value="section2">Medical, Dental, Dietary, Sensory</TabsTrigger>
          <TabsTrigger value="section3">Mental / Behavioral / Cognitive</TabsTrigger>
          <TabsTrigger value="section4">Social &amp; Recreational</TabsTrigger>
          <TabsTrigger value="summary">Summary &amp; Participation</TabsTrigger>
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
                {(["supervision", "mobility", "medications"] as const).map((key) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs capitalize">{key}</Label>
                    <Textarea
                      placeholder="Level / description"
                      className="min-h-20 text-xs"
                      value={content.section1[key].needsDescription}
                      onChange={(e) => update({ ...content, section1: { ...content.section1, [key]: { ...content.section1[key], needsDescription: e.target.value } } })}
                    />
                    <Textarea
                      placeholder="Plan to meet the need"
                      className="min-h-20 text-xs"
                      value={content.section1[key].planDescription}
                      onChange={(e) => update({ ...content, section1: { ...content.section1, [key]: { ...content.section1[key], planDescription: e.target.value } } })}
                    />
                  </div>
                ))}
              </fieldset>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Personal Care Needs (22 items)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
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
                title="Physical Medical Diagnoses" maxRows={8} readOnly={isReadOnly}
                rows={content.section2.physicalDiagnoses} noneChecked={content.section2.noPhysicalDiagnoses}
                onRowsChange={(rows) => update({ ...content, section2: { ...content.section2, physicalDiagnoses: rows } })}
                onNoneChange={(v) => update({ ...content, section2: { ...content.section2, noPhysicalDiagnoses: v } })}
              />
              <DiagnosisRowsEditor
                title="Dental Needs" maxRows={2} readOnly={isReadOnly}
                rows={content.section2.dental} noneChecked={content.section2.noDental}
                onRowsChange={(rows) => update({ ...content, section2: { ...content.section2, dental: rows } })}
                onNoneChange={(v) => update({ ...content, section2: { ...content.section2, noDental: v } })}
              />
              <DiagnosisRowsEditor
                title="Dietary Needs" maxRows={2} readOnly={isReadOnly}
                rows={content.section2.dietary} noneChecked={content.section2.noDietary}
                onRowsChange={(rows) => update({ ...content, section2: { ...content.section2, dietary: rows } })}
                onNoneChange={(v) => update({ ...content, section2: { ...content.section2, noDietary: v } })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Sensory Needs</CardTitle></CardHeader>
            <CardContent className="space-y-3">
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
                title="Psychological Medical Diagnoses" maxRows={8} readOnly={isReadOnly}
                rows={content.section3.psychologicalDiagnoses} noneChecked={content.section3.noPsychologicalDiagnoses}
                onRowsChange={(rows) => update({ ...content, section3: { ...content.section3, psychologicalDiagnoses: rows } })}
                onNoneChange={(v) => update({ ...content, section3: { ...content.section3, noPsychologicalDiagnoses: v } })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Mental Health, Behavioral Health, Cognitive Functioning</CardTitle></CardHeader>
            <CardContent className="space-y-3">
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
                  <Label className="text-xs">Assessor's Printed Name</Label>
                  <Input className="h-9" value={content.participation.assessorName}
                    onChange={(e) => update({ ...content, participation: { ...content.participation, assessorName: e.target.value } })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Assessor's Title</Label>
                  <Input className="h-9" value={content.participation.assessorTitle}
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
                {content.participation.participants.map((p, i) => (
                  <div key={i} className="border rounded-lg p-2 grid sm:grid-cols-4 gap-2 items-end">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Name</Label>
                      <Input className="h-8 text-xs" value={p.name} disabled={isReadOnly}
                        onChange={(e) => update({ ...content, participation: { ...content.participation, participants: content.participation.participants.map((r, j) => j === i ? { ...r, name: e.target.value } : r) } })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Relationship</Label>
                      <Input className="h-8 text-xs" value={p.relationshipToResident} disabled={isReadOnly}
                        onChange={(e) => update({ ...content, participation: { ...content.participation, participants: content.participation.participants.map((r, j) => j === i ? { ...r, relationshipToResident: e.target.value } : r) } })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Date Signed</Label>
                      <Input type="date" className="h-8 text-xs" value={p.signedDate} disabled={isReadOnly}
                        onChange={(e) => update({ ...content, participation: { ...content.participation, participants: content.participation.participants.map((r, j) => j === i ? { ...r, signedDate: e.target.value } : r) } })} />
                    </div>
                    {!isReadOnly && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => update({ ...content, participation: { ...content.participation, participants: content.participation.participants.filter((_, j) => j !== i) } })}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
                {!isReadOnly && (
                  <Button variant="outline" size="sm" onClick={() => update({ ...content, participation: { ...content.participation, participants: [...content.participation.participants, emptyParticipantRow()] } })}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add Participant
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
