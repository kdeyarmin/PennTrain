import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { useParams, Link, useLocation } from "wouter";
import { useGetResident } from "@/hooks/useResidents";
import { useListFacilities } from "@/hooks/useFacilities";
import {
  useGetResidentAssessmentForm,
  useSaveResidentAssessmentFormDraft,
  useFinalizeResidentAssessmentForm,
  useGenerateResidentAssessmentFormPdf,
  useGenerateResidentAssessmentSummary,
} from "@/hooks/useResidentAssessmentForms";
import { useListResidentDocuments } from "@/hooks/useResidentDocuments";
import {
  ADL_ITEMS,
  SENSORY_ITEMS,
  SOCIAL_ITEMS,
  behavioralItems,
  responsiblePartyOptions,
  createEmptyContent,
  mergeContentWithDefaults,
  applyPatchToAll,
  buildResidentAssessmentAutoFill,
  getIncompleteSections,
  SECTION_LABELS,
  degreeItemAnswered,
  simpleNeedAnswered,
  diagnosisRowsAnswered,
  CARE_DEGREE_OPTIONS,
  BEHAVIORAL_DEGREE_OPTIONS,
  FREQUENCY_OPTIONS,
  REASON_OPTIONS,
  COPY_PROVIDED_OPTIONS,
  NO_SIGNATURE_REASON_OPTIONS,
  RELATIONSHIP_OPTIONS,
  ASSESSOR_TITLE_OPTIONS,
  emptyDiagnosisRow,
  emptyParticipantRow,
  type ResidentAssessmentFormContent,
  type DegreeItemAnswer,
  type SimpleNeedAnswer,
  type DiagnosisRow,
  type ParticipantRow,
  type FormType,
  type SectionItem,
  type FacilityCareDefaults,
  type FormSectionKey,
} from "@/lib/residentAssessmentFormSchema";
import { getComplianceFormLabel } from "@/lib/residentCompliance";
import { assessmentFormDocumentLabel } from "@/lib/stateFormWorkflow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const AUTOSAVE_DEBOUNCE_MS = 1500;

const TAB_SEQUENCE: FormSectionKey[] = [
  "info",
  "section1",
  "section2",
  "section3",
  "section4",
  "summary",
];
// "review" is a 7th tab that isn't one of the 6 FormSectionKeys getIncompleteSections()/the PDF
// track -- it's a UI-only drill-down, not a form-content section, so it stays out of TAB_SEQUENCE
// and SECTION_LABELS (which the "N of 6 sections" banner text and the PDF's incomplete-notice both
// rely on staying exactly the 6 canonical sections).
type TabValue = FormSectionKey | "review";
const ALL_TAB_VALUES: readonly string[] = [...TAB_SEQUENCE, "review"];

function DegreeSelect({
  formType,
  value,
  allOtherValue,
  onChange,
  onAllOtherChange,
  scale,
}: {
  formType: FormType;
  value: string;
  allOtherValue: string;
  onChange: (v: string) => void;
  onAllOtherChange: (v: string) => void;
  scale: { value: string; label: string }[];
}) {
  if (formType === "ASP") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[11px] text-muted-foreground">
            Preliminary
          </Label>
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Degree" />
            </SelectTrigger>
            <SelectContent>
              {scale.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">All Other</Label>
          <Select value={allOtherValue} onValueChange={onAllOtherChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Degree" />
            </SelectTrigger>
            <SelectContent>
              {scale.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs w-40">
        <SelectValue placeholder="Degree" />
      </SelectTrigger>
      <SelectContent>
        {scale.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// A Select that always resets to its placeholder after a pick -- it exists to drop a common value
// into a plain-text field the user can still hand-edit afterward, not to represent that field's
// current state (unlike every other Select in this file, which is bound to the field it controls).
function QuickFillSelect({
  options,
  onPick,
  placeholder,
  className,
  disabled,
}: {
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
  placeholder: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value="" onValueChange={onPick} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Most residents share the same degree rating or the same plan frequency/responsible party across
// nearly every item in a 22-item (or 11/12-item) list -- filling each one by hand is the single
// biggest source of repetitive clicking in this form. These bars set a value once and apply it to
// every item in the list below them; the assessor then only needs to touch the exceptions. They
// always reset after applying (like QuickFillSelect) since they're a one-shot action, not a control
// bound to any single item's state.
function BulkDegreeBar({
  formType,
  scale,
  onApply,
}: {
  formType: FormType;
  scale: { value: string; label: string }[];
  onApply: (patch: { degree?: string; degreeAllOther?: string }) => void;
}) {
  const [value, setValue] = useState("");
  const [allOtherValue, setAllOtherValue] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-2 bg-muted/40">
      <p className="text-xs text-muted-foreground w-full sm:w-auto sm:mr-1">
        Set degree for all, then adjust exceptions:
      </p>
      <DegreeSelect
        formType={formType}
        value={value}
        allOtherValue={allOtherValue}
        onChange={setValue}
        onAllOtherChange={setAllOtherValue}
        scale={scale}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!value && !allOtherValue}
        onClick={() => {
          onApply({
            degree: value || undefined,
            degreeAllOther: allOtherValue || undefined,
          });
          setValue("");
          setAllOtherValue("");
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
  formType,
  frequency,
  frequencyOther,
  responsibleParty,
  responsiblePartyOther,
  onFrequencyChange,
  onFrequencyOtherChange,
  onPartyChange,
  onPartyOtherChange,
  disabled,
}: {
  formType: FormType;
  frequency: string;
  frequencyOther: string;
  responsibleParty: string;
  responsiblePartyOther: string;
  onFrequencyChange: (v: string) => void;
  onFrequencyOtherChange: (v: string) => void;
  onPartyChange: (v: string) => void;
  onPartyOtherChange: (v: string) => void;
  disabled?: boolean;
}) {
  const partyOptions = responsiblePartyOptions(formType);
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Select
          value={frequency}
          onValueChange={(v) => {
            onFrequencyChange(v);
            if (v !== "other") onFrequencyOtherChange("");
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Frequency" />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {frequency === "other" && (
          <Input
            placeholder="Specify frequency"
            className="h-8 text-xs"
            value={frequencyOther}
            disabled={disabled}
            onChange={(e) => onFrequencyOtherChange(e.target.value)}
          />
        )}
      </div>
      <div className="space-y-1">
        <Select
          value={responsibleParty}
          onValueChange={(v) => {
            onPartyChange(v);
            if (v !== "O") onPartyOtherChange("");
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Responsible party" />
          </SelectTrigger>
          <SelectContent>
            {partyOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {responsibleParty === "O" && (
          <Input
            placeholder="Specify responsible party"
            className="h-8 text-xs"
            value={responsiblePartyOther}
            disabled={disabled}
            onChange={(e) => onPartyOtherChange(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

function BulkPlanBar({
  formType,
  onApply,
}: {
  formType: FormType;
  onApply: (patch: {
    planFrequency?: string;
    planFrequencyOther?: string;
    planResponsibleParty?: string;
    planResponsiblePartyOther?: string;
  }) => void;
}) {
  const [frequency, setFrequency] = useState("");
  const [frequencyOther, setFrequencyOther] = useState("");
  const [party, setParty] = useState("");
  const [partyOther, setPartyOther] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-2 bg-muted/40">
      <p className="text-xs text-muted-foreground w-full sm:w-auto sm:mr-1">
        Set plan frequency/party for all, then adjust exceptions:
      </p>
      <FrequencyPartyFields
        formType={formType}
        frequency={frequency}
        frequencyOther={frequencyOther}
        responsibleParty={party}
        responsiblePartyOther={partyOther}
        onFrequencyChange={setFrequency}
        onFrequencyOtherChange={setFrequencyOther}
        onPartyChange={setParty}
        onPartyOtherChange={setPartyOther}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!frequency && !party}
        onClick={() => {
          onApply({
            planFrequency: frequency || undefined,
            planFrequencyOther:
              frequency === "other" ? frequencyOther : undefined,
            planResponsibleParty: party || undefined,
            planResponsiblePartyOther: party === "O" ? partyOther : undefined,
          });
          setFrequency("");
          setFrequencyOther("");
          setParty("");
          setPartyOther("");
        }}
      >
        Apply to All
      </Button>
    </div>
  );
}

// Memoized: this editor renders per-item (22 items in section1 alone), and every keystroke
// anywhere in the form used to re-render all of them because the onChange below was a fresh
// closure on every parent render. It only actually prevents re-renders because the call sites
// pass a per-item callback pulled from a handler map that's memoized once (see e.g.
// section1ItemHandlers below) instead of an inline arrow function -- `answer` is already
// reference-stable for every item except the one just edited, since `update()`'s immutable
// spreads never touch the other items' entries.
const DegreeItemEditor = memo(function DegreeItemEditor({
  item,
  formType,
  answer,
  onChange,
  scale,
  readOnly,
}: {
  item: SectionItem;
  formType: FormType;
  answer: DegreeItemAnswer;
  onChange: (next: DegreeItemAnswer) => void;
  scale: { value: string; label: string }[];
  readOnly: boolean;
}) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-medium">{item.label}</p>
        <fieldset disabled={readOnly}>
          <DegreeSelect
            formType={formType}
            value={answer.degree}
            allOtherValue={answer.degreeAllOther}
            onChange={(v) =>
              onChange({ ...answer, degree: v, degreePreliminary: v })
            }
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
              onCheckedChange={(c) =>
                onChange({ ...answer, serviceNeedNotApplicable: !!c })
              }
            />
            <Label className="text-xs">Assessment: not applicable</Label>
          </div>
          {!answer.serviceNeedNotApplicable && (
            <Textarea
              placeholder="Service need description"
              className="text-xs min-h-16"
              value={answer.serviceNeedDescription}
              onChange={(e) =>
                onChange({ ...answer, serviceNeedDescription: e.target.value })
              }
            />
          )}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={answer.planNotApplicable}
              onCheckedChange={(c) =>
                onChange({ ...answer, planNotApplicable: !!c })
              }
            />
            <Label className="text-xs">Support plan: not applicable</Label>
          </div>
          {!answer.planNotApplicable && (
            <>
              <Textarea
                placeholder="Plan to meet the need"
                className="text-xs min-h-16"
                value={answer.planDescription}
                onChange={(e) =>
                  onChange({ ...answer, planDescription: e.target.value })
                }
              />
              <FrequencyPartyFields
                formType={formType}
                frequency={answer.planFrequency}
                frequencyOther={answer.planFrequencyOther}
                responsibleParty={answer.planResponsibleParty}
                responsiblePartyOther={answer.planResponsiblePartyOther}
                onFrequencyChange={(v) =>
                  onChange({ ...answer, planFrequency: v })
                }
                onFrequencyOtherChange={(v) =>
                  onChange({ ...answer, planFrequencyOther: v })
                }
                onPartyChange={(v) =>
                  onChange({ ...answer, planResponsibleParty: v })
                }
                onPartyOtherChange={(v) =>
                  onChange({ ...answer, planResponsiblePartyOther: v })
                }
              />
            </>
          )}
        </div>
      </fieldset>
    </div>
  );
});

// Memoized for the same reason as DegreeItemEditor above -- callers must pass a stable per-item
// onChange (see section2SensoryHandlers/section4ItemHandlers) for this to actually take effect.
const SimpleNeedEditor = memo(function SimpleNeedEditor({
  item,
  formType,
  answer,
  onChange,
  readOnly,
}: {
  item: SectionItem;
  formType: FormType;
  answer: SimpleNeedAnswer;
  onChange: (next: SimpleNeedAnswer) => void;
  readOnly: boolean;
}) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{item.label}</p>
        <fieldset disabled={readOnly} className="flex items-center gap-1.5">
          <Checkbox
            checked={answer.applicable}
            onCheckedChange={(c) => onChange({ ...answer, applicable: !!c })}
          />
          <Label className="text-xs">Applicable</Label>
        </fieldset>
      </div>
      {answer.applicable && (
        <fieldset disabled={readOnly} className="space-y-2">
          <Textarea
            placeholder="Description"
            className="text-xs min-h-14"
            value={answer.description}
            onChange={(e) =>
              onChange({ ...answer, description: e.target.value })
            }
          />
          <Textarea
            placeholder="Plan to meet the need"
            className="text-xs min-h-14"
            value={answer.planDescription}
            onChange={(e) =>
              onChange({ ...answer, planDescription: e.target.value })
            }
          />
          <FrequencyPartyFields
            formType={formType}
            frequency={answer.planFrequency}
            frequencyOther={answer.planFrequencyOther}
            responsibleParty={answer.planResponsibleParty}
            responsiblePartyOther={answer.planResponsiblePartyOther}
            onFrequencyChange={(v) => onChange({ ...answer, planFrequency: v })}
            onFrequencyOtherChange={(v) =>
              onChange({ ...answer, planFrequencyOther: v })
            }
            onPartyChange={(v) =>
              onChange({ ...answer, planResponsibleParty: v })
            }
            onPartyOtherChange={(v) =>
              onChange({ ...answer, planResponsiblePartyOther: v })
            }
          />
        </fieldset>
      )}
    </div>
  );
});

interface ReviewCheckItem {
  label: string;
  ok: boolean;
  detail?: string;
}
function ReviewChecklistRow({ item }: { item: ReviewCheckItem }) {
  return (
    <div className="flex items-start gap-2 py-2">
      {item.ok ? (
        <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
      )}
      <div>
        <p className="text-sm">{item.label}</p>
        {!item.ok && item.detail && (
          <p className="text-xs text-muted-foreground">{item.detail}</p>
        )}
      </div>
    </div>
  );
}

function DiagnosisRowsEditor({
  title,
  rows,
  noneChecked,
  onRowsChange,
  onNoneChange,
  readOnly,
  maxRows,
  formType,
  planDefaults,
}: {
  title: string;
  rows: DiagnosisRow[];
  noneChecked: boolean;
  onRowsChange: (rows: DiagnosisRow[]) => void;
  onNoneChange: (v: boolean) => void;
  readOnly: boolean;
  maxRows: number;
  formType: FormType;
  planDefaults?: FacilityCareDefaults;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        <fieldset disabled={readOnly} className="flex items-center gap-1.5">
          <Checkbox
            checked={noneChecked}
            onCheckedChange={(c) => onNoneChange(!!c)}
          />
          <Label className="text-xs">None</Label>
        </fieldset>
      </div>
      {!noneChecked && (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const updateRow = (patch: Partial<DiagnosisRow>) =>
              onRowsChange(
                rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
              );
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() =>
                        onRowsChange(rows.filter((_, j) => j !== i))
                      }
                      aria-label="Remove diagnosis"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
                <Input
                  placeholder="Plan to meet the need"
                  className="h-8 text-xs"
                  value={row.planDescription}
                  disabled={readOnly}
                  onChange={(e) =>
                    updateRow({ planDescription: e.target.value })
                  }
                />
                <FrequencyPartyFields
                  formType={formType}
                  disabled={readOnly}
                  frequency={row.planFrequency}
                  frequencyOther={row.planFrequencyOther}
                  responsibleParty={row.planResponsibleParty}
                  responsiblePartyOther={row.planResponsiblePartyOther}
                  onFrequencyChange={(v) => updateRow({ planFrequency: v })}
                  onFrequencyOtherChange={(v) =>
                    updateRow({ planFrequencyOther: v })
                  }
                  onPartyChange={(v) => updateRow({ planResponsibleParty: v })}
                  onPartyOtherChange={(v) =>
                    updateRow({ planResponsiblePartyOther: v })
                  }
                />
              </div>
            );
          })}
          {!readOnly && rows.length < maxRows && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onRowsChange([
                  ...rows,
                  {
                    ...emptyDiagnosisRow(),
                    ...(planDefaults?.responsibleParty
                      ? { planResponsibleParty: planDefaults.responsibleParty }
                      : {}),
                    ...(planDefaults?.frequency
                      ? { planFrequency: planDefaults.frequency }
                      : {}),
                  },
                ])
              }
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
  const [location] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const residentPathPrefix = location.startsWith("/admin/") ? "/admin/residents" : "/app/residents";

  const { data: resident } = useGetResident(residentId);
  const { data: facilities } = useListFacilities();
  const { data: form, isLoading } = useGetResidentAssessmentForm(formId);
  const { data: residentDocuments } = useListResidentDocuments(residentId);
  const saveDraft = useSaveResidentAssessmentFormDraft();
  const finalize = useFinalizeResidentAssessmentForm();
  const generatePdf = useGenerateResidentAssessmentFormPdf();
  const generateSummary = useGenerateResidentAssessmentSummary();

  const canManage = [
    "platform_admin",
    "org_admin",
    "facility_manager",
  ].includes(user?.role ?? "");
  const facility = facilities?.find((f) => f.id === resident?.facility_id);
  const formLabel = getComplianceFormLabel(facility?.facility_type);

  const [content, setContent] = useState<ResidentAssessmentFormContent | null>(
    null,
  );
  const [aiSummaryAssist, setAiSummaryAssist] = useState<{
    suggestedAdditions: string[];
    followUpQuestions: string[];
  } | null>(null);
  const [autoFillChanges, setAutoFillChanges] = useState<string[] | null>(null);
  const contentRef = useRef<ResidentAssessmentFormContent | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{
    id: string;
    content: ResidentAssessmentFormContent;
  } | null>(null);
  const isReadOnly = !canManage || form?.status === "finalized";
  const flushPendingAutosave = () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pendingSave.current) {
      const pending = pendingSave.current;
      pendingSave.current = null;
      saveDraft.mutate(pending);
    }
  };

  const tabStorageKey = (id: string) => `resident-assessment-form-tab:${id}`;
  const readStoredTab = (id: string): TabValue => {
    const stored = window.sessionStorage.getItem(tabStorageKey(id));
    return stored && ALL_TAB_VALUES.includes(stored)
      ? (stored as TabValue)
      : "info";
  };

  // Leaving this page (e.g. to check something on the resident's profile) and coming back used to
  // always drop the user back on the "info" tab, forcing them to re-navigate to wherever they'd
  // gotten to. Restore whichever tab they were last on for this specific form -- keyed by formId so
  // switching to a different resident's form doesn't inherit the wrong tab. Read synchronously via
  // the lazy initializer (rather than an effect that calls setActiveTab after mount) so there's no
  // render where activeTab is still "info" before the persist effect below can fire and clobber the
  // just-restored value back to "info".
  const [activeTab, setActiveTab] = useState<TabValue>(() =>
    formId ? readStoredTab(formId) : "info",
  );
  const lastRestoredFormId = useRef(formId);
  const tabsTopRef = useRef<HTMLDivElement>(null);
  const goToTab = (value: TabValue) => {
    setActiveTab(value);
    tabsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const nextButton = (to: TabValue) => (
    <div className="flex justify-end">
      <Button variant="outline" onClick={() => goToTab(to)}>
        Next: {to === "review" ? "Review" : SECTION_LABELS[to]}{" "}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );

  // Handles switching to a *different* form's URL without a full remount (the lazy initializer
  // above only covers first mount) -- guarded so it doesn't re-run on every render.
  useEffect(() => {
    if (!formId || formId === lastRestoredFormId.current) return;
    flushPendingAutosave();
    lastRestoredFormId.current = formId;
    setActiveTab(readStoredTab(formId));
  }, [formId]);

  useEffect(() => {
    if (!formId) return;
    window.sessionStorage.setItem(tabStorageKey(formId), activeTab);
  }, [activeTab, formId]);

  useEffect(() => {
    if (!form) return;
    flushPendingAutosave();
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
    const nextContent = mergeContentWithDefaults(
      createEmptyContent(form.form_type as FormType, {
        responsibleParty: facility?.default_care_responsible_party,
        frequency: facility?.default_care_frequency,
      }),
      form.content,
    );
    contentRef.current = nextContent;
    setContent(nextContent);
    setAiSummaryAssist(null);
    setAutoFillChanges(null);
  }, [form?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: ResidentAssessmentFormContent) => {
    contentRef.current = next;
    setContent(next);
    if (isReadOnly || !formId) return;
    pendingSave.current = { id: formId, content: next };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      pendingSave.current = null;
      saveDraft.mutate(
        { id: formId, content: next },
        {
          // A failed autosave (e.g. someone else finalized this form in another tab, so RLS now
          // rejects the update since it's no longer a draft) used to fail completely silently --
          // the user would keep editing a form that was never actually being saved, with no
          // indication anything was wrong until they navigated away and lost the changes.
          onError: (e: Error) =>
            toast({
              title: "Failed to save changes",
              description: e.message,
              variant: "destructive",
            }),
        },
      );
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  // Navigating away (e.g. "Back to Resident") within the debounce window used to just cancel the
  // scheduled save and drop those edits silently -- there's no separate manual Save button, so the
  // debounced autosave is the only path those changes had. Flush whatever's pending instead of
  // discarding it; the mutation still completes even though the component has unmounted.
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (pendingSave.current) saveDraft.mutate(pendingSave.current);
      }
    },
    [],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  // "Latest value" refs, resynced on every render -- let the per-item handler maps below stay
  // referentially stable forever (computed once via useMemo(..., []) ) while still always reading
  // and writing the current content/update, instead of closing over whatever they were on the
  // render that created them. This is what makes DegreeItemEditor/SimpleNeedEditor's React.memo
  // actually skip re-rendering untouched items: a fresh inline arrow function passed as onChange
  // on every keystroke would defeat memo() no matter how stable `answer` itself is.
  contentRef.current = content;
  const updateRef = useRef(update);
  updateRef.current = update;

  const handleAutoFillKnownFields = () => {
    if (!content) return;
    const today = toLocalIsoDate();
    const { nextContent, changedFields } = buildResidentAssessmentAutoFill(
      content,
      {
        formType,
        assessmentReason:
          form?.reason as typeof content.assessmentInfo.assessmentReason,
        assessorName: user ? `${user.firstName} ${user.lastName}`.trim() : "",
        today,
        residentName: resident
          ? `${resident.first_name} ${resident.last_name}`.trim()
          : "",
        designatedPersonName: resident?.designated_person_name,
      },
    );

    if (changedFields.length === 0) {
      setAutoFillChanges([]);
      toast({
        title: "Nothing new to auto-complete",
        description:
          "Known fields were already filled or no matching CareMetric data was available.",
      });
      return;
    }

    update(nextContent);
    setAutoFillChanges(changedFields);
    toast({
      title: "Known fields auto-completed",
      description: `${changedFields.length} field${changedFields.length === 1 ? "" : "s"} filled. Review before finalizing.`,
    });
  };

  const handleGenerateWellnessSummary = async () => {
    if (!formId || !content) return;
    const runGeneration = () =>
      generateSummary.mutate(formId, {
        onSuccess: ({ summary, suggested_additions, follow_up_questions }) => {
          const latestContent = contentRef.current;
          if (!latestContent) return;
          update({ ...latestContent, summary: { overallWellness: summary } });
          setAiSummaryAssist({
            suggestedAdditions: suggested_additions,
            followUpQuestions: follow_up_questions,
          });
          toast({ title: "AI wellness summary drafted" });
        },
        onError: (e: Error) =>
          toast({
            title: "Failed to generate wellness summary",
            description: e.message,
            variant: "destructive",
          }),
      });

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pendingSave.current) {
      const pending = pendingSave.current;
      pendingSave.current = null;
      try {
        await saveDraft.mutateAsync(pending);
      } catch (e) {
        toast({
          title: "Failed to save latest changes before generating",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
        return;
      }
    }
    runGeneration();
  };

  const appendToWellnessSummary = (text: string) => {
    const latestContent = contentRef.current;
    if (!latestContent) return;
    const currentSummary = latestContent.summary.overallWellness.trim();
    const nextSummary = currentSummary ? `${currentSummary}

${text}` : text;
    update({ ...latestContent, summary: { overallWellness: nextSummary } });
  };

  const behavioralList = useMemo(
    () => behavioralItems((form?.form_type as FormType) ?? "RASP"),
    [form?.form_type],
  );

  // One stable onChange per item key, keyed on the item lists themselves (ADL_ITEMS/SOCIAL_ITEMS/
  // SENSORY_ITEMS are module-level constants; behavioralList is its own stable useMemo above) --
  // computed once and never again, so DegreeItemEditor/SimpleNeedEditor see the same function
  // reference across every render no matter what else in the form changed.
  const section1ItemHandlers = useMemo(() => {
    const map = new Map<string, (next: DegreeItemAnswer) => void>();
    for (const item of ADL_ITEMS) {
      map.set(item.key, (next) => {
        const prev = contentRef.current;
        if (!prev) return;
        updateRef.current({
          ...prev,
          section1: {
            ...prev.section1,
            items: { ...prev.section1.items, [item.key]: next },
          },
        });
      });
    }
    return map;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const section3ItemHandlers = useMemo(() => {
    const map = new Map<string, (next: DegreeItemAnswer) => void>();
    for (const item of behavioralList) {
      map.set(item.key, (next) => {
        const prev = contentRef.current;
        if (!prev) return;
        updateRef.current({
          ...prev,
          section3: {
            ...prev.section3,
            items: { ...prev.section3.items, [item.key]: next },
          },
        });
      });
    }
    return map;
  }, [behavioralList]);

  const section2SensoryHandlers = useMemo(() => {
    const map = new Map<string, (next: SimpleNeedAnswer) => void>();
    for (const item of SENSORY_ITEMS) {
      map.set(item.key, (next) => {
        const prev = contentRef.current;
        if (!prev) return;
        updateRef.current({
          ...prev,
          section2: {
            ...prev.section2,
            sensory: { ...prev.section2.sensory, [item.key]: next },
          },
        });
      });
    }
    return map;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const section4ItemHandlers = useMemo(() => {
    const map = new Map<string, (next: SimpleNeedAnswer) => void>();
    for (const item of SOCIAL_ITEMS) {
      map.set(item.key, (next) => {
        const prev = contentRef.current;
        if (!prev) return;
        updateRef.current({
          ...prev,
          section4: {
            ...prev.section4,
            items: { ...prev.section4.items, [item.key]: next },
          },
        });
      });
    }
    return map;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Memoized on the specific item maps (not the whole `content` object, which changes on every
  // keystroke anywhere in the form) so typing in an unrelated field doesn't re-filter these lists;
  // rated counts (below, after the loading guard) are derived from these unrated lists rather than
  // re-filtered separately, so the tab badge and the Review tab's named gaps can't drift out of
  // sync with each other. Guarded on `content` since it's still null before the initial-content
  // effect runs -- these hooks must stay above the loading-guard's early return either way.
  const unratedAdlItems = useMemo(
    () =>
      content
        ? ADL_ITEMS.filter(
            (item) =>
              !degreeItemAnswered(
                content.section1.items[item.key],
                (form?.form_type as FormType) ?? "RASP",
              ),
          )
        : [],
    [form?.form_type, content?.section1.items],
  );
  const unratedBehavioralItems = useMemo(
    () =>
      content
        ? behavioralList.filter(
            (item) =>
              !degreeItemAnswered(
                content.section3.items[item.key],
                (form?.form_type as FormType) ?? "RASP",
              ),
          )
        : [],
    [form?.form_type, behavioralList, content?.section3.items],
  );
  // Mirrors getIncompleteSections' section1 check exactly (needs/plan description, not the degree
  // `level` field) so this list and the "N of 6 sections" banner can't disagree about section1.
  const unansweredCareLevels = useMemo(
    () =>
      content
        ? (["supervision", "mobility", "medications"] as const).filter(
            (key) =>
              !content.section1[key].needsDescription.trim() ||
              !content.section1[key].planDescription.trim(),
          )
        : [],
    [content?.section1],
  );
  const unaddressedSensoryItems = useMemo(
    () =>
      content
        ? SENSORY_ITEMS.filter(
            (item) => !simpleNeedAnswered(content.section2.sensory[item.key]),
          )
        : [],
    [content?.section2.sensory],
  );
  const unaddressedSocialItems = useMemo(
    () =>
      content
        ? SOCIAL_ITEMS.filter(
            (item) => !simpleNeedAnswered(content.section4.items[item.key]),
          )
        : [],
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
        toast({
          title: "Failed to save latest changes before finalizing",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
        return;
      }
    }
    finalize.mutate(formId, {
      onSuccess: () => toast({
        title: `${formLabel} finalized and saved as a PDF`,
        description: "This is a reference copy. Attach the signed, DHS-prescribed form on the resident's page to complete the compliance record.",
      }),
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
  const facilityPlanDefaults = {
    responsibleParty: facility?.default_care_responsible_party,
    frequency: facility?.default_care_frequency,
  };
  // generate-resident-assessment-pdf/index.ts refuses (409) once a resident_documents row with this
  // form's document_label exists -- it's a one-shot "finalize succeeded but PDF generation failed"
  // retry, not a true regenerate. Only offer the button while that row is still missing, otherwise
  // it's guaranteed to fail.
  const hasGeneratedPdf = (residentDocuments ?? []).some(
    (d) => d.document_label === assessmentFormDocumentLabel(form.id),
  );
  // Advisory only -- see getIncompleteSections' comment. Recomputed on every render off `content`
  // instead of memoized: the item-list walk is small (well under 100 items) and content already
  // changes on every keystroke via `update`, so a useMemo here would just add bookkeeping for no
  // real savings.
  const incompleteSections = getIncompleteSections(content, formType);

  // A condensed pre-finalize checklist -- one row per tab, built directly on top of
  // getIncompleteSections so this list and the "N of 6 sections" banner above can never disagree
  // about which sections are incomplete. Deliberately checks presence/completeness signals only
  // (not content quality), since this can't judge whether an answer is *correct*.
  const reviewChecklist: ReviewCheckItem[] = TAB_SEQUENCE.map((key) => {
    const ok = !incompleteSections.includes(key);
    let detail: string | undefined;
    switch (key) {
      case "section1": {
        const missing = [
          ...unansweredCareLevels.map((k) => k[0].toUpperCase() + k.slice(1)),
          ...unratedAdlItems.map((i) => i.label),
        ];
        detail = missing.length
          ? `Still needs: ${missing.join(", ")}`
          : undefined;
        break;
      }
      case "section2": {
        const missing = [
          !diagnosisRowsAnswered(
            content.section2.physicalDiagnoses,
            content.section2.noPhysicalDiagnoses,
          ) && "Physical medical diagnoses",
          !diagnosisRowsAnswered(
            content.section2.dental,
            content.section2.noDental,
          ) && "Dental needs",
          !diagnosisRowsAnswered(
            content.section2.dietary,
            content.section2.noDietary,
          ) && "Dietary needs",
          ...unaddressedSensoryItems.map((i) => i.label),
        ].filter((v): v is string => !!v);
        detail = missing.length
          ? `Still needs: ${missing.join(", ")}`
          : undefined;
        break;
      }
      case "section3": {
        const missing = [
          !diagnosisRowsAnswered(
            content.section3.psychologicalDiagnoses,
            content.section3.noPsychologicalDiagnoses,
          ) && "Psychological diagnoses",
          ...unratedBehavioralItems.map((i) => i.label),
        ].filter((v): v is string => !!v);
        detail = missing.length
          ? `Still needs: ${missing.join(", ")}`
          : undefined;
        break;
      }
      case "section4":
        detail = unaddressedSocialItems.length
          ? `Still needs a description or "not applicable": ${unaddressedSocialItems.map((i) => i.label).join(", ")}`
          : undefined;
        break;
      case "info":
        detail = !ok
          ? "Needs: Reason for Assessment, Reason for Support Plan"
          : undefined;
        break;
      case "summary":
        detail = !ok
          ? "Needs: Overall Wellness Summary, and assessor name/title/signed date"
          : undefined;
        break;
    }
    return { label: SECTION_LABELS[key], ok, detail };
  });
  const reviewIncompleteCount = incompleteSections.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`${residentPathPrefix}/${residentId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Resident
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              {formLabel} — v{form.version_number}
              {form.status === "finalized" && (
                <Badge variant="outline">
                  <Lock className="mr-1 h-3 w-3" /> Finalized
                </Badge>
              )}
              {form.status === "draft" && (
                <Badge variant="outline">Draft</Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {resident?.last_name}, {resident?.first_name} · {facility?.name}
            </p>
          </div>
        </div>
        {!isReadOnly && (
          <Button
            onClick={handleFinalize}
            disabled={finalize.isPending || saveDraft.isPending}
          >
            {finalize.isPending || saveDraft.isPending
              ? "Finalizing..."
              : `Finalize ${formLabel}`}
          </Button>
        )}
        {canManage && form.status === "finalized" && !hasGeneratedPdf && (
          <Button
            variant="outline"
            disabled={generatePdf.isPending}
            onClick={() =>
              generatePdf.mutate(formId!, {
                onSuccess: () => toast({ title: `${formLabel} PDF generated` }),
                onError: (e: Error) =>
                  toast({
                    title: "Failed to generate PDF",
                    description: e.message,
                    variant: "destructive",
                  }),
              })
            }
          >
            {generatePdf.isPending ? "Generating..." : "Generate PDF"}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Drafting/reference tool only — finalizing does not by itself satisfy the resident's compliance
        requirement. Documents like the {formLabel} have to be on the state-approved form, no exception:
        attach the signed DHS-prescribed form on the resident's page to mark the item complete.
      </p>
      {!isReadOnly && (
        <Alert className="border-primary/30 bg-primary/[0.03] [&>svg]:text-primary">
          <Wand2 className="h-4 w-4" />
          <AlertTitle>Auto-complete known state-form fields</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Pull in the safest known values from the resident profile,
              compliance item, current user, and today&apos;s date. Narrative
              needs, diagnoses, degree ratings, and support-plan text are never
              guessed or overwritten.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAutoFillKnownFields}
              >
                <Wand2 className="mr-2 h-4 w-4" />
                Auto-complete known fields
              </Button>
              {autoFillChanges && autoFillChanges.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Filled: {autoFillChanges.join(", ")}
                </span>
              )}
              {autoFillChanges && autoFillChanges.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  No additional known fields were available.
                </span>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
      {incompleteSections.length > 0 && (
        <Alert className="border-warning/50 bg-warning/10 [&>svg]:text-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {incompleteSections.length} of {TAB_SEQUENCE.length} sections have
            unanswered items
          </AlertTitle>
          <AlertDescription>
            {incompleteSections.map((key) => SECTION_LABELS[key]).join(", ")}.
            You can still save, finalize, and print this {formLabel} as-is --
            these sections stay flagged for follow-up.
          </AlertDescription>
        </Alert>
      )}

      <div ref={tabsTopRef} />
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
      >
        <TabsList className="flex-wrap h-auto">
          {TAB_SEQUENCE.map((key) => (
            <TabsTrigger key={key} value={key} className="gap-1.5">
              {SECTION_LABELS[key]}
              {incompleteSections.includes(key) && (
                <AlertTriangle className="h-3 w-3 text-warning" />
              )}
            </TabsTrigger>
          ))}
          <TabsTrigger value="review" className="gap-1.5">
            Review
            {reviewIncompleteCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-1.5 px-1.5 py-0 text-[10px]"
              >
                {reviewIncompleteCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Part I &amp; II — Resident and Assessment Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Facility, resident, and preparer identifying info is pulled
                automatically from your CareMetric records at print time —
                nothing here duplicates it.
              </p>
              <fieldset
                disabled={isReadOnly}
                className="grid sm:grid-cols-2 gap-4"
              >
                <div className="space-y-1.5">
                  <Label className="text-xs">Reason for Assessment</Label>
                  <Select
                    value={content.assessmentInfo.assessmentReason}
                    onValueChange={(v) =>
                      update({
                        ...content,
                        assessmentInfo: {
                          ...content.assessmentInfo,
                          assessmentReason:
                            v as typeof content.assessmentInfo.assessmentReason,
                        },
                      })
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {REASON_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reason for Support Plan</Label>
                  <Select
                    value={content.assessmentInfo.supportPlanReason}
                    onValueChange={(v) =>
                      update({
                        ...content,
                        assessmentInfo: {
                          ...content.assessmentInfo,
                          supportPlanReason:
                            v as typeof content.assessmentInfo.supportPlanReason,
                        },
                      })
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {REASON_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Last Assessment Date</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={content.assessmentInfo.lastAssessmentDate}
                    onChange={(e) =>
                      update({
                        ...content,
                        assessmentInfo: {
                          ...content.assessmentInfo,
                          lastAssessmentDate: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Last Support Plan Date</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={content.assessmentInfo.lastSupportPlanDate}
                    onChange={(e) =>
                      update({
                        ...content,
                        assessmentInfo: {
                          ...content.assessmentInfo,
                          lastSupportPlanDate: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                {(content.assessmentInfo.assessmentReason ===
                  "significant_change" ||
                  content.assessmentInfo.supportPlanReason ===
                    "significant_change") && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">
                      Description of Significant Change
                    </Label>
                    <Textarea
                      value={content.assessmentInfo.changeDescription}
                      onChange={(e) =>
                        update({
                          ...content,
                          assessmentInfo: {
                            ...content.assessmentInfo,
                            changeDescription: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                )}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">
                    Comments or Related Information
                  </Label>
                  <Textarea
                    value={content.residentInfo.comments}
                    onChange={(e) =>
                      update({
                        ...content,
                        residentInfo: {
                          ...content.residentInfo,
                          comments: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              </fieldset>
            </CardContent>
          </Card>
          {nextButton("section1")}
        </TabsContent>

        <TabsContent value="section1" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Supervision, Mobility, Medications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <fieldset
                disabled={isReadOnly}
                className="grid sm:grid-cols-3 gap-4"
              >
                {(["supervision", "mobility", "medications"] as const).map(
                  (key) => {
                    const s = content.section1[key];
                    const updateField = (patch: Partial<typeof s>) =>
                      update({
                        ...content,
                        section1: {
                          ...content.section1,
                          [key]: { ...s, ...patch },
                        },
                      });
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label className="text-xs capitalize">{key}</Label>
                        <Select
                          value={s.level}
                          onValueChange={(v) => updateField({ level: v })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Degree" />
                          </SelectTrigger>
                          <SelectContent>
                            {CARE_DEGREE_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Textarea
                          placeholder="Description of need"
                          className="min-h-20 text-xs"
                          value={s.needsDescription}
                          onChange={(e) =>
                            updateField({ needsDescription: e.target.value })
                          }
                        />
                        <Textarea
                          placeholder="Plan to meet the need"
                          className="min-h-20 text-xs"
                          value={s.planDescription}
                          onChange={(e) =>
                            updateField({ planDescription: e.target.value })
                          }
                        />
                        <Select
                          value={s.planResponsibleParty}
                          onValueChange={(v) =>
                            updateField({ planResponsibleParty: v })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Responsible party" />
                          </SelectTrigger>
                          <SelectContent>
                            {responsiblePartyOptions(formType).map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {s.planResponsibleParty === "O" && (
                          <Input
                            placeholder="Specify responsible party"
                            className="h-8 text-xs"
                            value={s.planResponsiblePartyOther}
                            onChange={(e) =>
                              updateField({
                                planResponsiblePartyOther: e.target.value,
                              })
                            }
                          />
                        )}
                      </div>
                    );
                  },
                )}
              </fieldset>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Personal Care Needs (22 items)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!isReadOnly && (
                <>
                  <BulkDegreeBar
                    formType={formType}
                    scale={degreeScale}
                    onApply={(patch) =>
                      update({
                        ...content,
                        section1: {
                          ...content.section1,
                          // degree/degreePreliminary mirror each other (see DegreeItemEditor's own
                          // onChange) -- applyPatchToAll drops whichever key was left unset, so this
                          // doesn't need its own "only include what changed" guard anymore.
                          items: applyPatchToAll(content.section1.items, {
                            degree: patch.degree,
                            degreePreliminary: patch.degree,
                            degreeAllOther: patch.degreeAllOther,
                          }),
                        },
                      })
                    }
                  />
                  <BulkPlanBar
                    formType={formType}
                    onApply={(patch) =>
                      update({
                        ...content,
                        section1: {
                          ...content.section1,
                          items: applyPatchToAll(content.section1.items, patch),
                        },
                      })
                    }
                  />
                </>
              )}
              {ADL_ITEMS.map((item) => (
                <DegreeItemEditor
                  key={item.key}
                  item={item}
                  formType={formType}
                  scale={degreeScale}
                  readOnly={isReadOnly}
                  answer={content.section1.items[item.key]}
                  onChange={section1ItemHandlers.get(item.key)!}
                />
              ))}
            </CardContent>
          </Card>
          {nextButton("section2")}
        </TabsContent>

        <TabsContent value="section2" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Medical &amp; Dental &amp; Dietary Diagnoses
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DiagnosisRowsEditor
                title="Physical Medical Diagnoses"
                maxRows={8}
                readOnly={isReadOnly}
                formType={formType}
                planDefaults={facilityPlanDefaults}
                rows={content.section2.physicalDiagnoses}
                noneChecked={content.section2.noPhysicalDiagnoses}
                onRowsChange={(rows) =>
                  update({
                    ...content,
                    section2: { ...content.section2, physicalDiagnoses: rows },
                  })
                }
                onNoneChange={(v) =>
                  update({
                    ...content,
                    section2: { ...content.section2, noPhysicalDiagnoses: v },
                  })
                }
              />
              <DiagnosisRowsEditor
                title="Dental Needs"
                maxRows={2}
                readOnly={isReadOnly}
                formType={formType}
                planDefaults={facilityPlanDefaults}
                rows={content.section2.dental}
                noneChecked={content.section2.noDental}
                onRowsChange={(rows) =>
                  update({
                    ...content,
                    section2: { ...content.section2, dental: rows },
                  })
                }
                onNoneChange={(v) =>
                  update({
                    ...content,
                    section2: { ...content.section2, noDental: v },
                  })
                }
              />
              <DiagnosisRowsEditor
                title="Dietary Needs"
                maxRows={2}
                readOnly={isReadOnly}
                formType={formType}
                planDefaults={facilityPlanDefaults}
                rows={content.section2.dietary}
                noneChecked={content.section2.noDietary}
                onRowsChange={(rows) =>
                  update({
                    ...content,
                    section2: { ...content.section2, dietary: rows },
                  })
                }
                onNoneChange={(v) =>
                  update({
                    ...content,
                    section2: { ...content.section2, noDietary: v },
                  })
                }
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sensory Needs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!isReadOnly && (
                <BulkPlanBar
                  formType={formType}
                  onApply={(patch) =>
                    update({
                      ...content,
                      section2: {
                        ...content.section2,
                        sensory: applyPatchToAll(
                          content.section2.sensory,
                          patch,
                        ),
                      },
                    })
                  }
                />
              )}
              {SENSORY_ITEMS.map((item) => (
                <SimpleNeedEditor
                  key={item.key}
                  item={item}
                  formType={formType}
                  readOnly={isReadOnly}
                  answer={content.section2.sensory[item.key]}
                  onChange={section2SensoryHandlers.get(item.key)!}
                />
              ))}
            </CardContent>
          </Card>
          {nextButton("section3")}
        </TabsContent>

        <TabsContent value="section3" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Psychological Diagnoses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DiagnosisRowsEditor
                title="Psychological Medical Diagnoses"
                maxRows={8}
                readOnly={isReadOnly}
                formType={formType}
                planDefaults={facilityPlanDefaults}
                rows={content.section3.psychologicalDiagnoses}
                noneChecked={content.section3.noPsychologicalDiagnoses}
                onRowsChange={(rows) =>
                  update({
                    ...content,
                    section3: {
                      ...content.section3,
                      psychologicalDiagnoses: rows,
                    },
                  })
                }
                onNoneChange={(v) =>
                  update({
                    ...content,
                    section3: {
                      ...content.section3,
                      noPsychologicalDiagnoses: v,
                    },
                  })
                }
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Mental Health, Behavioral Health, Cognitive Functioning
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!isReadOnly && (
                <>
                  <BulkDegreeBar
                    formType={formType}
                    scale={BEHAVIORAL_DEGREE_OPTIONS}
                    onApply={(patch) =>
                      update({
                        ...content,
                        section3: {
                          ...content.section3,
                          items: applyPatchToAll(content.section3.items, {
                            ...(patch.degree !== undefined
                              ? {
                                  degree: patch.degree,
                                  degreePreliminary: patch.degree,
                                }
                              : {}),
                            ...(patch.degreeAllOther !== undefined
                              ? { degreeAllOther: patch.degreeAllOther }
                              : {}),
                          }),
                        },
                      })
                    }
                  />
                  <BulkPlanBar
                    formType={formType}
                    onApply={(patch) =>
                      update({
                        ...content,
                        section3: {
                          ...content.section3,
                          items: applyPatchToAll(content.section3.items, patch),
                        },
                      })
                    }
                  />
                </>
              )}
              {behavioralList.map((item) => (
                <DegreeItemEditor
                  key={item.key}
                  item={item}
                  formType={formType}
                  scale={BEHAVIORAL_DEGREE_OPTIONS}
                  readOnly={isReadOnly}
                  answer={content.section3.items[item.key]}
                  onChange={section3ItemHandlers.get(item.key)!}
                />
              ))}
            </CardContent>
          </Card>
          {nextButton("section4")}
        </TabsContent>

        <TabsContent value="section4" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Social and Recreational Needs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!isReadOnly && (
                <BulkPlanBar
                  formType={formType}
                  onApply={(patch) =>
                    update({
                      ...content,
                      section4: {
                        ...content.section4,
                        items: applyPatchToAll(content.section4.items, patch),
                      },
                    })
                  }
                />
              )}
              {SOCIAL_ITEMS.map((item) => (
                <SimpleNeedEditor
                  key={item.key}
                  item={item}
                  formType={formType}
                  readOnly={isReadOnly}
                  answer={content.section4.items[item.key]}
                  onChange={section4ItemHandlers.get(item.key)!}
                />
              ))}
            </CardContent>
          </Card>
          {nextButton("summary")}
        </TabsContent>

        <TabsContent value="summary" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Part IV — Summary and Determination
              </CardTitle>
            </CardHeader>
            <CardContent>
              <fieldset disabled={isReadOnly}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-xs">
                    Summary of Resident's Overall Wellness
                  </Label>
                  {!isReadOnly && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateWellnessSummary}
                      disabled={
                        generateSummary.isPending || saveDraft.isPending
                      }
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      {generateSummary.isPending
                        ? "Drafting…"
                        : "Draft with AI"}
                    </Button>
                  )}
                </div>
                <Textarea
                  className="min-h-28"
                  value={content.summary.overallWellness}
                  onChange={(e) =>
                    update({
                      ...content,
                      summary: { overallWellness: e.target.value },
                    })
                  }
                />
                {!isReadOnly && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    AI drafts must be reviewed before finalizing. The prompt is
                    constrained to use only saved assessment content and to omit
                    unsupported facts.
                  </p>
                )}
                {!isReadOnly &&
                  aiSummaryAssist &&
                  (aiSummaryAssist.suggestedAdditions.length > 0 ||
                    aiSummaryAssist.followUpQuestions.length > 0) && (
                    <div className="mt-4 space-y-3 rounded-md border bg-muted/30 p-3">
                      <div>
                        <p className="text-sm font-medium">
                          AI review suggestions
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Verified suggestions can be added manually. Questions
                          identify details the AI could not verify, so they are
                          not added automatically.
                        </p>
                      </div>
                      {aiSummaryAssist.suggestedAdditions.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-muted-foreground">
                            Verified addable details
                          </p>
                          {aiSummaryAssist.suggestedAdditions.map(
                            (suggestion, index) => (
                              <div
                                key={`${suggestion}-${index}`}
                                className="flex flex-col gap-2 rounded-md border bg-background p-2 sm:flex-row sm:items-start sm:justify-between"
                              >
                                <p className="text-sm">{suggestion}</p>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    appendToWellnessSummary(suggestion)
                                  }
                                >
                                  Add to summary
                                </Button>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                      {aiSummaryAssist.followUpQuestions.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-muted-foreground">
                            Questions before adding unsupported details
                          </p>
                          {aiSummaryAssist.followUpQuestions.map(
                            (question, index) => (
                              <div
                                key={`${question}-${index}`}
                                className="flex flex-col gap-2 rounded-md border bg-background p-2 sm:flex-row sm:items-start sm:justify-between"
                              >
                                <p className="text-sm">{question}</p>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    appendToWellnessSummary(
                                      `Follow-up needed: ${question}`,
                                    )
                                  }
                                >
                                  Add note
                                </Button>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  )}
              </fieldset>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Part V — Participation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <fieldset
                disabled={isReadOnly}
                className="grid sm:grid-cols-3 gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Assessor's Printed Name</Label>
                    {!isReadOnly && user && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-[11px]"
                        onClick={() =>
                          update({
                            ...content,
                            participation: {
                              ...content.participation,
                              assessorName:
                                `${user.firstName} ${user.lastName}`.trim(),
                            },
                          })
                        }
                      >
                        Use my name
                      </Button>
                    )}
                  </div>
                  <Input
                    className="h-9"
                    value={content.participation.assessorName}
                    onChange={(e) =>
                      update({
                        ...content,
                        participation: {
                          ...content.participation,
                          assessorName: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Assessor's Title</Label>
                  <QuickFillSelect
                    className="h-9"
                    placeholder="Quick fill…"
                    options={ASSESSOR_TITLE_OPTIONS}
                    onPick={(v) =>
                      update({
                        ...content,
                        participation: {
                          ...content.participation,
                          assessorTitle: v,
                        },
                      })
                    }
                  />
                  <Input
                    className="h-9"
                    placeholder="Title"
                    value={content.participation.assessorTitle}
                    onChange={(e) =>
                      update({
                        ...content,
                        participation: {
                          ...content.participation,
                          assessorTitle: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date Signed</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={content.participation.assessorSignedDate}
                    onChange={(e) =>
                      update({
                        ...content,
                        participation: {
                          ...content.participation,
                          assessorSignedDate: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              </fieldset>
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Participants (resident, family, etc.)
                </p>
                {content.participation.participants.map((p, i) => {
                  const updateParticipant = (patch: Partial<ParticipantRow>) =>
                    update({
                      ...content,
                      participation: {
                        ...content.participation,
                        participants: content.participation.participants.map(
                          (r, j) => (j === i ? { ...r, ...patch } : r),
                        ),
                      },
                    });
                  return (
                    <div key={i} className="border rounded-lg p-2 space-y-2">
                      <div className="grid sm:grid-cols-4 gap-2 items-start">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Name</Label>
                          <Input
                            className="h-8 text-xs"
                            value={p.name}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              updateParticipant({ name: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Relationship</Label>
                          <QuickFillSelect
                            className="h-8 text-xs"
                            placeholder="Quick fill…"
                            options={RELATIONSHIP_OPTIONS}
                            disabled={isReadOnly}
                            onPick={(v) =>
                              updateParticipant({ relationshipToResident: v })
                            }
                          />
                          <Input
                            className="h-8 text-xs"
                            placeholder="Relationship"
                            value={p.relationshipToResident}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              updateParticipant({
                                relationshipToResident: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Date Signed</Label>
                          <Input
                            type="date"
                            className="h-8 text-xs"
                            value={p.signedDate}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              updateParticipant({ signedDate: e.target.value })
                            }
                          />
                        </div>
                        {!isReadOnly && (
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() =>
                                update({
                                  ...content,
                                  participation: {
                                    ...content.participation,
                                    participants:
                                      content.participation.participants.filter(
                                        (_, j) => j !== i,
                                      ),
                                  },
                                })
                              }
                              aria-label="Remove participant"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <fieldset
                        disabled={isReadOnly}
                        className="grid sm:grid-cols-3 gap-2 items-end"
                      >
                        <div className="flex items-center gap-1.5">
                          <Checkbox
                            checked={!!p.copyRequested}
                            onCheckedChange={(c) =>
                              updateParticipant({ copyRequested: !!c })
                            }
                          />
                          <Label className="text-[11px]">Copy Requested</Label>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Copy Provided</Label>
                          <Select
                            value={p.copyProvided || "na"}
                            onValueChange={(v) =>
                              updateParticipant({
                                copyProvided:
                                  v as ParticipantRow["copyProvided"],
                              })
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Copy provided?" />
                            </SelectTrigger>
                            <SelectContent>
                              {COPY_PROVIDED_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {!p.signedDate && (
                          <div className="space-y-1">
                            <Label className="text-[11px]">
                              Reason Not Signed
                            </Label>
                            <Select
                              value={p.noSignatureReason || ""}
                              onValueChange={(v) =>
                                updateParticipant({
                                  noSignatureReason: v,
                                  ...(v === "other"
                                    ? {}
                                    : { noSignatureReasonOther: "" }),
                                })
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Reason" />
                              </SelectTrigger>
                              <SelectContent>
                                {NO_SIGNATURE_REASON_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {p.noSignatureReason === "other" && (
                              <Input
                                className="h-8 text-xs"
                                placeholder="Specify"
                                value={p.noSignatureReasonOther || ""}
                                onChange={(e) =>
                                  updateParticipant({
                                    noSignatureReasonOther: e.target.value,
                                  })
                                }
                              />
                            )}
                          </div>
                        )}
                      </fieldset>
                    </div>
                  );
                })}
                {!isReadOnly && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      update({
                        ...content,
                        participation: {
                          ...content.participation,
                          participants: [
                            ...content.participation.participants,
                            emptyParticipantRow(),
                          ],
                        },
                      })
                    }
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add Participant
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
          {nextButton("review")}
        </TabsContent>

        <TabsContent value="review" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                <span>Pre-Finalize Review</span>
                {reviewIncompleteCount === 0 ? (
                  <Badge className="bg-success text-success-foreground hover:bg-success/80">
                    All checks passed
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    {reviewIncompleteCount} item
                    {reviewIncompleteCount === 1 ? "" : "s"} to check
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {reviewChecklist.map((item, i) => (
                <ReviewChecklistRow key={i} item={item} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
