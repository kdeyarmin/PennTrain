import { useId, useState } from "react";
import { Link, useParams } from "wouter";
import { Activity, AlertTriangle, ArrowLeft, DatabaseZap, HeartPulse, Pill, Plus, Share2, ShieldCheck, Stethoscope } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { useGetResident } from "@/hooks/useResidents";
import {
  type ClinicalDataConsent,
  type ClinicalObservation,
  type ObservationType,
  useAmendClinicalObservation,
  useQueueClinicalObservationWriteback,
  useRecordClinicalObservation,
  useResidentClinicalChartSummary,
  useResidentClinicalObservations,
  useSetResidentClinicalDataConsent,
} from "@/hooks/useClinicalObservations";
import { useResidentFhirClinical, useResidentFhirWritebackTarget } from "@/hooks/useFhirIntegration";
import { ResidentCareDocumentation } from "@/components/residents/ResidentCareDocumentation";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/lib/pageTitle";
import { toFacilityDateTimeLocal, facilityDateTimeLocalToUtcIso} from "@/lib/dateUtils";
import {
  OBSERVATION_CONFIG,
  OBSERVATION_ORDER,
  abnormalBadge,
  observationTitle,
  observationValue,
  summaryVitalTitle,
  summaryVitalValue,
  titleCase,
} from "@/lib/clinicalObservations";

export default function ResidentClinicalChart() {
  const __fieldIds = useId();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const resident = useGetResident(id);
  // Retracted observations are excluded by default -- the chart is what care is delivered from, and
  // an entered-in-error vital does not belong in it. But the retraction has to remain answerable
  // afterwards, which is what this shows: the observation, struck through, with the reason.
  const [showRetracted, setShowRetracted] = useState(false);
  const observations = useResidentClinicalObservations(id, undefined, showRetracted);
  const fhir = useResidentFhirClinical(id, "Resident clinical chart view");
  const summary = useResidentClinicalChartSummary(id, "Resident clinical chart view");

  const activeAllergies = (fhir.data?.allergies ?? []).filter(
    (allergy) => !["inactive", "resolved"].includes(allergy.clinical_status ?? ""),
  );
  const activeMedications = (fhir.data?.medications ?? []).filter((medication) => medication.request_status === "active");

  const residentName = resident.data ? `${resident.data.first_name} ${resident.data.last_name}` : "Resident";
  usePageTitle(`${residentName} · Clinical chart`);

  const canChart = ["platform_admin", "org_admin", "facility_manager", "employee"].includes(user?.role ?? "");
  const canManageConsent = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const disclosureAllowed = resident.data?.clinical_data_consent === "granted";
  // Write-back is offered only where it can actually happen. Two separate gates, both real:
  //
  //  1. ROLE. 20260725170000 granted `clinical.integration.writeback` to the platform_admin,
  //     org_admin and facility_manager role templates only, and
  //     `queue_clinical_observation_writeback` runs `assert_clinical_integration_scope` against it.
  //     An `employee` is inside `canChart`, so every carer saw a button that answers 42501
  //     ("Clinical integration access denied") every single time.
  //  2. TARGET. The same RPC refuses unless the resident has an active patient mapping to a source
  //     that is `status = 'active'` AND `writeback_enabled`. Nothing in the product turns
  //     `writeback_enabled` on -- the column defaults false, `save_fhir_integration_source` does
  //     not write it, and `fhir_integration_sources` has no update policy -- so this is normally
  //     null and the action stays out of the way instead of promising an EHR delivery that the
  //     server refuses and the drain could not authenticate anyway (see FhirIntegration.tsx).
  const canRequestWriteback = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const writebackTarget = useResidentFhirWritebackTarget(id, canRequestWriteback);
  // No target means the action cannot work at all, and a permanently disabled button says so only
  // in a `title` the shadcn Button suppresses (`disabled:pointer-events-none`) -- so the reason is
  // stated once, in the tab, and the per-row action is simply not offered. Consent is different:
  // it is a state a manager can change today, so that stays a disabled button with the reason on a
  // wrapper span, which does receive pointer events.
  const writebackOffered = canRequestWriteback && Boolean(writebackTarget.data);
  const writebackUnavailable =
    canRequestWriteback && !writebackTarget.isLoading && !writebackTarget.data;

  const [recordOpen, setRecordOpen] = useState(false);
  const [observationType, setObservationType] = useState<ObservationType>("blood_pressure");
  const [valueNumeric, setValueNumeric] = useState("");
  const [valueSecondary, setValueSecondary] = useState("");
  const [valueText, setValueText] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [unit, setUnit] = useState(OBSERVATION_CONFIG.blood_pressure.unit);
  const [observedAt, setObservedAt] = useState(() => toFacilityDateTimeLocal());
  const [note, setNote] = useState("");
  const record = useRecordClinicalObservation();

  const [retracting, setRetracting] = useState<ClinicalObservation | null>(null);
  const [retractReason, setRetractReason] = useState("");
  const amend = useAmendClinicalObservation();
  const queueWriteback = useQueueClinicalObservationWriteback();
  const setConsent = useSetResidentClinicalDataConsent();
  const [consentReason, setConsentReason] = useState("");

  const config = OBSERVATION_CONFIG[observationType];
  const isCustom = observationType === "custom";

  const chooseType = (next: ObservationType) => {
    setObservationType(next);
    setUnit(OBSERVATION_CONFIG[next].unit === "{score}" ? "" : OBSERVATION_CONFIG[next].unit);
    setValueSecondary("");
  };

  const resetRecordForm = () => {
    setObservationType("blood_pressure");
    setUnit(OBSERVATION_CONFIG.blood_pressure.unit);
    setValueNumeric(""); setValueSecondary(""); setValueText(""); setCustomLabel(""); setNote("");
    setObservedAt(toFacilityDateTimeLocal());
  };

  const submitObservation = async () => {
    if (!id) return;
    const numeric = valueNumeric.trim() === "" ? null : Number(valueNumeric);
    if (numeric != null && Number.isNaN(numeric)) {
      toast({ title: "Enter a valid number", variant: "destructive" });
      return;
    }
    try {
      await record.mutateAsync({
        residentId: id,
        observationType,
        observedAt: facilityDateTimeLocalToUtcIso(observedAt),
        valueNumeric: numeric,
        valueSecondary: valueSecondary.trim() === "" ? null : Number(valueSecondary),
        valueText: valueText.trim() || null,
        unit: unit.trim() || null,
        customLabel: isCustom ? customLabel.trim() || null : null,
        loincCode: config.loinc ?? null,
        note: note.trim() || null,
      });
      setRecordOpen(false);
      resetRecordForm();
      toast({ title: "Observation recorded" });
    } catch (error) {
      toast({
        title: "Observation could not be recorded",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const submitRetraction = async () => {
    if (!id || !retracting || retractReason.trim().length < 3) return;
    try {
      await amend.mutateAsync({
        residentId: id,
        observationId: retracting.id,
        amendmentType: "entered_in_error",
        reason: retractReason.trim(),
      });
      setRetracting(null);
      setRetractReason("");
      toast({ title: "Observation retracted (entered in error)" });
    } catch (error) {
      toast({
        title: "Observation could not be retracted",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  if (resident.isError) {
    return <QueryError what="resident" error={resident.error} onRetry={() => resident.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={id ? `/app/residents/${id}` : "/app/residents"} className="mb-1 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-1 h-4 w-4" />Back to resident
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <HeartPulse className="h-6 w-6 text-rose-600" />
            {resident.isLoading ? <Skeleton className="h-7 w-48" /> : residentName}
            <span className="text-lg font-normal text-muted-foreground">· Clinical chart</span>
          </h1>
          {resident.data?.room && <p className="text-muted-foreground">Room {resident.data.room}</p>}
        </div>
        {canChart && (
          <Button onClick={() => { resetRecordForm(); setRecordOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />Record observation
          </Button>
        )}
      </div>

      {resident.data && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>
            Clinical data consent: {resident.data.clinical_data_consent.replace(/_/gu, " ")}
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Charting stays available regardless of this posture. Outbound disclosure — FHIR write-back,
              organization clinical export, and designated-person portal documents — requires{" "}
              <span className="font-medium">granted</span> consent.
            </p>
            {canManageConsent && id && (
              <div className="flex flex-wrap items-end gap-2 pt-1">
                <div className="space-y-1">
                  <Label htmlFor={`${__fieldIds}-clinical-consent`}>Update consent</Label>
                  <Select
                    value={resident.data.clinical_data_consent}
                    onValueChange={(value) => {
                      const next = value as ClinicalDataConsent;
                      if (next === "restricted" || next === "revoked") {
                        if (consentReason.trim().length < 3) {
                          toast({
                            title: "Reason required",
                            description: "Add a short reason before restricting or revoking disclosure consent.",
                            variant: "destructive",
                          });
                          return;
                        }
                      }
                      setConsent.mutate(
                        { residentId: id, consent: next, reason: consentReason.trim() || null },
                        {
                          onSuccess: () => {
                            toast({ title: "Clinical disclosure consent updated" });
                            setConsentReason("");
                          },
                          onError: (error) =>
                            toast({
                              title: "Could not update consent",
                              description: error instanceof Error ? error.message : String(error),
                              variant: "destructive",
                            }),
                        },
                      );
                    }}
                    disabled={setConsent.isPending}
                  >
                    <SelectTrigger id={`${__fieldIds}-clinical-consent`} className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_recorded">Not recorded</SelectItem>
                      <SelectItem value="granted">Granted</SelectItem>
                      <SelectItem value="restricted">Restricted</SelectItem>
                      <SelectItem value="revoked">Revoked</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[220px] flex-1 space-y-1">
                  <Label htmlFor={`${__fieldIds}-consent-reason`}>Reason (required to restrict/revoke)</Label>
                  <Input
                    id={`${__fieldIds}-consent-reason`}
                    value={consentReason}
                    onChange={(event) => setConsentReason(event.target.value)}
                    placeholder="Representative withdrew authorization"
                  />
                </div>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {activeAllergies.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Allergies</AlertTitle>
          <AlertDescription>
            {activeAllergies.map((allergy) => `${allergy.substance_display}${allergy.criticality ? ` (${allergy.criticality})` : ""}`).join(" · ")}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="vitals">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="medications">Medications</TabsTrigger>
          <TabsTrigger value="allergies">Allergies &amp; diagnoses</TabsTrigger>
          <TabsTrigger value="vitals">Vitals &amp; observations</TabsTrigger>
          <TabsTrigger value="care">Care &amp; notes</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          {summary.isError ? (
            <QueryError what="clinical summary" error={summary.error} onRetry={() => summary.refetch()} />
          ) : summary.isLoading ? (
            <Card><CardContent className="space-y-3 p-4"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-2/3" /></CardContent></Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Active medications</p><p className="text-2xl font-semibold">{(summary.data?.medications ?? []).length}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Active problems</p><p className="text-2xl font-semibold">{(summary.data?.problems ?? []).length}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Allergies</p><p className="text-2xl font-semibold">{(summary.data?.allergies ?? []).length}</p></div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" />Latest observations</CardTitle>
                  <CardDescription>Most recent value recorded for each observation type.</CardDescription>
                </CardHeader>
                <CardContent>
                  {(summary.data?.latestVitals ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No observations recorded yet.</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {[...(summary.data?.latestVitals ?? [])]
                        .sort((a, b) =>
                          OBSERVATION_ORDER.indexOf(a.observation_type as ObservationType) -
                          OBSERVATION_ORDER.indexOf(b.observation_type as ObservationType))
                        .map((vital) => {
                          const badge = abnormalBadge(vital.abnormal_flag);
                          return (
                            <div key={vital.observation_type} className="rounded-lg border p-3">
                              <p className="text-xs text-muted-foreground">{summaryVitalTitle(vital.observation_type)}</p>
                              <p className="text-xl font-semibold">{summaryVitalValue(vital)}</p>
                              <div className="mt-1 flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">{new Date(vital.observed_at).toLocaleString()}</span>
                                {badge && <Badge variant="outline" className={badge.className}>{badge.label}</Badge>}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Stethoscope className="h-4 w-4" />Active problem list</CardTitle>
                    <CardDescription>Conditions ingested read-only from the connected EHR (FHIR).</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(summary.data?.problems ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No active conditions on file.</p> : (
                      <ul className="space-y-1 text-sm">
                        {(summary.data?.problems ?? []).slice(0, 8).map((problem, index) => (
                          <li key={`${problem.code ?? problem.display}-${index}`} className="flex items-center justify-between gap-2">
                            <span>{problem.display}</span>
                            {problem.code && <span className="text-xs text-muted-foreground">{problem.code}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Pill className="h-4 w-4" />Active medications</CardTitle>
                    <CardDescription>Ingested read-only from the connected EHR/pharmacy (FHIR).</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(summary.data?.medications ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No active medications on file.</p> : (
                      <ul className="space-y-1 text-sm">
                        {(summary.data?.medications ?? []).slice(0, 8).map((medication, index) => (
                          <li key={`${medication.rxnorm ?? medication.display}-${index}`} className="flex items-center justify-between gap-2">
                            <span>{medication.display}</span>
                            {medication.rxnorm && <span className="text-xs text-muted-foreground">RxNorm {medication.rxnorm}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Stethoscope className="h-4 w-4" />Recent assessments</CardTitle>
                    <CardDescription>Latest clinical assessments captured in-app.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(summary.data?.recentAssessments ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No assessments recorded yet.</p> : (
                      <ul className="space-y-2 text-sm">
                        {(summary.data?.recentAssessments ?? []).map((assessment, index) => (
                          <li key={`${assessment.assessmentType}-${index}`} className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="font-medium">{titleCase(assessment.assessmentType)}</span>
                              {assessment.score != null && (
                                <span className="ml-2 text-muted-foreground">
                                  Score {assessment.score}{assessment.riskBand ? ` · ${assessment.riskBand}` : ""}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">{new Date(assessment.assessedAt).toLocaleDateString()}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><HeartPulse className="h-4 w-4" />Recent progress notes</CardTitle>
                    <CardDescription>Latest notes charted in-app.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(summary.data?.recentNotes ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No progress notes recorded yet.</p> : (
                      <ul className="space-y-2 text-sm">
                        {(summary.data?.recentNotes ?? []).map((note, index) => (
                          <li key={`${note.noteType}-${index}`} className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{titleCase(note.noteType)}</span>
                              <Badge variant="outline">{note.status.replace(/_/gu, " ")}</Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">{new Date(note.authoredAt).toLocaleDateString()}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="medications" className="space-y-3">
          <Alert>
            <DatabaseZap className="h-4 w-4" />
            <AlertTitle>External source of truth</AlertTitle>
            <AlertDescription>
              Medications are ingested read-only via FHIR from the connected EHR/pharmacy ({activeMedications.length} active). Prescribe or change orders in the source system.
            </AlertDescription>
          </Alert>
          {fhir.isLoading ? (
            <Card><CardContent className="p-4"><Skeleton className="h-6 w-full" /></CardContent></Card>
          ) : fhir.isError ? (
            <QueryError what="medications" error={fhir.error} onRetry={() => void fhir.refetch()} />
          ) : (fhir.data?.medications ?? []).length === 0 ? (
            <Card><CardContent className="py-10 text-center"><Pill className="mx-auto mb-2 h-7 w-7 text-muted-foreground" /><p className="font-medium">No medications ingested</p><p className="text-sm text-muted-foreground">Connect a FHIR source and map this resident to see medications here.</p></CardContent></Card>
          ) : (fhir.data?.medications ?? []).map((medication) => (
            <Card key={medication.id}><CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{medication.medication_display}</p>
                  {medication.dosage_text && <p className="mt-1 text-sm">{medication.dosage_text}</p>}
                  {medication.rxnorm_code && <p className="text-xs text-muted-foreground">RxNorm {medication.rxnorm_code}</p>}
                </div>
                <Badge variant="outline">{medication.request_status.replace(/_/gu, " ")}</Badge>
              </div>
            </CardContent></Card>
          ))}
        </TabsContent>

        <TabsContent value="allergies" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />Allergies</CardTitle><CardDescription>Ingested read-only via FHIR.</CardDescription></CardHeader>
            <CardContent>
              {fhir.isLoading ? <p className="text-sm text-muted-foreground">Loading allergies…</p> : fhir.isError ? <QueryError what="allergies" error={fhir.error} onRetry={() => void fhir.refetch()} /> : (fhir.data?.allergies ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No allergies on file.</p> : (
                <div className="space-y-2">
                  {(fhir.data?.allergies ?? []).map((allergy) => (
                    <div key={allergy.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                      <div><p className="text-sm font-medium">{allergy.substance_display}</p>{allergy.clinical_status && <p className="text-xs text-muted-foreground">{allergy.clinical_status}</p>}</div>
                      {allergy.criticality && <Badge variant={allergy.criticality === "high" ? "destructive" : "outline"}>{allergy.criticality}</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Stethoscope className="h-4 w-4" />Diagnoses / problem list</CardTitle><CardDescription>Conditions ingested read-only via FHIR.</CardDescription></CardHeader>
            <CardContent>
              {fhir.isLoading ? <p className="text-sm text-muted-foreground">Loading diagnoses…</p> : fhir.isError ? <QueryError what="diagnoses" error={fhir.error} onRetry={() => void fhir.refetch()} /> : (fhir.data?.conditions ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No diagnoses on file.</p> : (
                <div className="space-y-2">
                  {(fhir.data?.conditions ?? []).map((condition) => (
                    <div key={condition.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                      <div><p className="text-sm font-medium">{condition.code_display}</p>{condition.category && <p className="text-xs text-muted-foreground">{condition.category.replace(/-/gu, " ")}</p>}</div>
                      <div className="flex items-center gap-2">{condition.code && <span className="text-xs text-muted-foreground">{condition.code}</span>}{condition.clinical_status && <Badge variant="outline">{condition.clinical_status}</Badge>}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vitals" className="space-y-3">
          {/* Said once, where it is true, instead of a "Send to EHR" button on every observation
              that the server refuses. See the writebackOffered comment above for both gates. */}
          {writebackUnavailable && (
            <Alert>
              <DatabaseZap className="h-4 w-4" />
              <AlertTitle>Write-back to an EHR is not available for this resident</AlertTitle>
              <AlertDescription>
                No connected FHIR source that this resident is mapped to is enabled for outbound
                write-back, and write-back cannot currently be enabled from CareBase. Observations
                recorded here stay in CareBase; see <Link href="/app/fhir-integration" className="underline">FHIR Integration</Link>.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant={showRetracted ? "secondary" : "ghost"}
              className="text-xs text-muted-foreground"
              onClick={() => setShowRetracted((on) => !on)}
            >
              {showRetracted ? "Hide retracted" : "Show retracted"}
            </Button>
          </div>
          {observations.isError ? (
            <QueryError what="clinical observations" error={observations.error} onRetry={() => observations.refetch()} />
          ) : observations.isLoading ? (
            <Card><CardContent className="space-y-3 p-4"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-3/4" /></CardContent></Card>
          ) : (observations.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <HeartPulse className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
                <p className="font-medium">No observations recorded</p>
                <p className="text-sm text-muted-foreground">
                  {canChart ? "Record the first vital sign or observation for this resident." : "No clinical observations have been captured yet."}
                </p>
              </CardContent>
            </Card>
          ) : (
            (observations.data ?? []).map((observation) => {
              const badge = abnormalBadge(observation.abnormal_flag);
              return (
                <Card key={observation.id}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
                    <div>
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <p className="font-medium">{observationTitle(observation)}</p>
                        {badge && <Badge variant="outline" className={badge.className}>{badge.label}</Badge>}
                        {observation.entered_in_error && (
                          <Badge variant="outline" className="border-destructive/40 text-destructive">Retracted</Badge>
                        )}
                      </div>
                      <p className={`text-2xl font-semibold tabular-nums${observation.entered_in_error ? " text-muted-foreground line-through" : ""}`}>
                        {observationValue(observation)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(observation.observed_at).toLocaleString()}
                        {observation.recorded_by_name ? ` · ${observation.recorded_by_name}` : ""}
                      </p>
                      {observation.entered_in_error && observation.error_reason && (
                        <p className="mt-1 text-xs text-destructive">Entered in error — {observation.error_reason}</p>
                      )}
                      {observation.note && <p className="mt-2 text-sm">{observation.note}</p>}
                    </div>
                    {/* Neither action applies once it is retracted: the server refuses a second
                        amendment with 'Observation is already retracted', and sending a withdrawn
                        vital to the resident's EHR is the opposite of what the retraction meant. */}
                    {canChart && !observation.entered_in_error && (
                      <div className="flex flex-wrap items-center gap-1">
                        {writebackOffered && (
                          <span title={disclosureAllowed ? `Queue for delivery to ${writebackTarget.data?.sourceName}` : "Requires granted clinical data consent"}>
                            <Button
                              size="sm" variant="ghost" className="text-muted-foreground"
                              disabled={queueWriteback.isPending || !disclosureAllowed}
                              onClick={() => queueWriteback.mutate({ residentId: id!, observationId: observation.id }, {
                                // Queued, not delivered: the drain records the outcome per row, so
                                // the toast must not claim an arrival it cannot know about.
                                onSuccess: () => toast({ title: "Queued for write-back", description: `Delivery to ${writebackTarget.data?.sourceName ?? "the connected EHR"} is attempted on the next write-back run; a failure is recorded against the source.` }),
                                // The server refuses unless consent is granted and the resident has an active
                                // mapping to a write-back-enabled FHIR source.
                                onError: (error) => toast({ title: "Not queued", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
                              })}
                            >
                              <Share2 className="mr-1 h-3.5 w-3.5" />Send to EHR
                            </Button>
                          </span>
                        )}
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setRetracting(observation); setRetractReason(""); }}>
                          <AlertTriangle className="mr-1 h-3.5 w-3.5" />Retract
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {id && (
          <TabsContent value="care">
            <ResidentCareDocumentation residentId={id} canChart={canChart} />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={recordOpen} onOpenChange={(open) => { setRecordOpen(open); if (!open) resetRecordForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record observation</DialogTitle>
            <DialogDescription>Capture a structured vital sign or observation. The abnormal flag is derived automatically.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${__fieldIds}-observation-type`}>Observation type</Label>
              <Select value={observationType} onValueChange={(value) => chooseType(value as ObservationType)}>
                <SelectTrigger id={`${__fieldIds}-observation-type`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OBSERVATION_ORDER.map((type) => (
                    <SelectItem key={type} value={type}>{OBSERVATION_CONFIG[type].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isCustom && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="obs-custom-label">Observation label</Label>
                <Input id="obs-custom-label" value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} placeholder="e.g. Peak flow" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="obs-value">{observationType === "blood_pressure" ? "Systolic" : "Value"}</Label>
              <Input id="obs-value" inputMode="decimal" value={valueNumeric} onChange={(event) => setValueNumeric(event.target.value)} placeholder={isCustom ? "Optional if using text" : ""} />
            </div>
            {config.secondaryLabel ? (
              <div className="space-y-2">
                <Label htmlFor="obs-secondary">{config.secondaryLabel}</Label>
                <Input id="obs-secondary" inputMode="decimal" value={valueSecondary} onChange={(event) => setValueSecondary(event.target.value)} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="obs-unit">Unit</Label>
                <Input id="obs-unit" value={unit} onChange={(event) => setUnit(event.target.value)} />
              </div>
            )}
            {isCustom && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="obs-text">Text value</Label>
                <Input id="obs-text" value={valueText} onChange={(event) => setValueText(event.target.value)} placeholder="Optional narrative value" />
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="obs-observed-at">Observed at</Label>
              <Input id="obs-observed-at" type="datetime-local" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="obs-note">Note</Label>
              <Textarea id="obs-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional context" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordOpen(false)}>Cancel</Button>
            <Button
              disabled={record.isPending || (valueNumeric.trim() === "" && valueText.trim() === "") || (isCustom && customLabel.trim() === "")}
              onClick={() => void submitObservation()}
            >
              {record.isPending ? "Saving…" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!retracting} onOpenChange={(open) => { if (!open) { setRetracting(null); setRetractReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retract observation</DialogTitle>
            <DialogDescription>
              Marks this observation as entered-in-error. The original value is preserved in the append-only
              amendment history rather than deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="retract-reason">Reason</Label>
            <Textarea id="retract-reason" value={retractReason} onChange={(event) => setRetractReason(event.target.value)} placeholder="Why is this observation being retracted?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRetracting(null); setRetractReason(""); }}>Cancel</Button>
            <Button variant="destructive" disabled={amend.isPending || retractReason.trim().length < 3} onClick={() => void submitRetraction()}>
              {amend.isPending ? "Saving…" : "Retract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
