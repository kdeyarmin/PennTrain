import { useId, useEffect, useMemo, useRef, useState } from "react";
import { facilityToday } from "@/lib/dateUtils";
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
  createEmptyContent,
  mergeContentWithDefaults,
  buildResidentAssessmentAutoFill,
  getIncompleteSections,
  SECTION_LABELS,
  degreeItemAnswered,
  simpleNeedAnswered,
  diagnosisRowsAnswered,
  type ResidentAssessmentFormContent,
  type DegreeItemAnswer,
  type SimpleNeedAnswer,
  type FormType,
} from "@/lib/residentAssessmentFormSchema";
import { getComplianceFormLabel } from "@/lib/residentCompliance";
import { assessmentFormDocumentLabel } from "@/lib/stateFormWorkflow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import {
  ArrowLeft,
  ArrowRight,
  Lock,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { ALL_TAB_VALUES, TAB_SEQUENCE, type ReviewCheckItem, type TabValue } from "./resident-assessment-form-tabs/types";
import { InfoTab } from "./resident-assessment-form-tabs/InfoTab";
import { Section1Tab } from "./resident-assessment-form-tabs/Section1Tab";
import { Section2Tab } from "./resident-assessment-form-tabs/Section2Tab";
import { Section3Tab } from "./resident-assessment-form-tabs/Section3Tab";
import { Section4Tab } from "./resident-assessment-form-tabs/Section4Tab";
import { SummaryTab } from "./resident-assessment-form-tabs/SummaryTab";
import { ReviewTab } from "./resident-assessment-form-tabs/ReviewTab";

const AUTOSAVE_DEBOUNCE_MS = 1500;

export default function ResidentAssessmentFormEditor() {
  const __fieldIds = useId();
  const { residentId, formId } = useParams<{ residentId: string; formId: string }>();
  const [location] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const residentPathPrefix = location.startsWith("/admin/") ? "/admin/residents" : "/app/residents";

  const { data: resident } = useGetResident(residentId);
  const { data: facilities } = useListFacilities();
  const { data: form, isLoading, isError, error, refetch } = useGetResidentAssessmentForm(formId);
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
    const today = facilityToday();
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

  if (isError) {
    return <QueryError what="this assessment form" error={error} onRetry={() => void refetch()} />;
  }

  if (isLoading || !content || !form) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const formType = form.form_type as FormType;
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

        <InfoTab
          content={content}
          update={update}
          isReadOnly={isReadOnly}
          fieldIds={__fieldIds}
          nextButton={nextButton}
        />

        <Section1Tab
          content={content}
          update={update}
          isReadOnly={isReadOnly}
          formType={formType}
          fieldIds={__fieldIds}
          section1ItemHandlers={section1ItemHandlers}
          nextButton={nextButton}
        />

        <Section2Tab
          content={content}
          update={update}
          isReadOnly={isReadOnly}
          formType={formType}
          facilityPlanDefaults={facilityPlanDefaults}
          section2SensoryHandlers={section2SensoryHandlers}
          nextButton={nextButton}
        />

        <Section3Tab
          content={content}
          update={update}
          isReadOnly={isReadOnly}
          formType={formType}
          facilityPlanDefaults={facilityPlanDefaults}
          behavioralList={behavioralList}
          section3ItemHandlers={section3ItemHandlers}
          nextButton={nextButton}
        />

        <Section4Tab
          content={content}
          update={update}
          isReadOnly={isReadOnly}
          formType={formType}
          section4ItemHandlers={section4ItemHandlers}
          nextButton={nextButton}
        />

        <SummaryTab
          content={content}
          update={update}
          isReadOnly={isReadOnly}
          fieldIds={__fieldIds}
          user={user}
          generateSummaryPending={generateSummary.isPending}
          saveDraftPending={saveDraft.isPending}
          handleGenerateWellnessSummary={handleGenerateWellnessSummary}
          aiSummaryAssist={aiSummaryAssist}
          appendToWellnessSummary={appendToWellnessSummary}
          nextButton={nextButton}
        />

        <ReviewTab
          reviewChecklist={reviewChecklist}
          reviewIncompleteCount={reviewIncompleteCount}
        />
      </Tabs>
    </div>
  );
}
