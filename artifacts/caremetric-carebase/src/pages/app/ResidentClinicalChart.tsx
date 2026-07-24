import { useState } from "react";
import { Link, useParams } from "wouter";
import { Activity, AlertTriangle, ArrowLeft, DatabaseZap, HeartPulse, Pill, Plus, ShieldCheck, Stethoscope } from "lucide-react";
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
  type ClinicalChartSummary,
  type ClinicalObservation,
  type ObservationType,
  useAmendClinicalObservation,
  useRecordClinicalObservation,
  useResidentClinicalChartSummary,
  useResidentClinicalObservations,
} from "@/hooks/useClinicalObservations";
import { useResidentFhirClinical } from "@/hooks/useFhirIntegration";
import { ResidentCareDocumentation } from "@/components/residents/ResidentCareDocumentation";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/lib/pageTitle";
import { toDateTimeLocal } from "@/lib/dateUtils";

const OBSERVATION_CONFIG: Record<
  ObservationType,
  { label: string; unit: string; secondaryLabel?: string; loinc?: string }
> = {
  blood_pressure: { label: "Blood pressure", unit: "mm[Hg]", secondaryLabel: "Diastolic", loinc: "85354-9" },
  heart_rate: { label: "Heart rate", unit: "/min", loinc: "8867-4" },
  respiratory_rate: { label: "Respiratory rate", unit: "/min", loinc: "9279-1" },
  temperature: { label: "Temperature", unit: "Cel", loinc: "8310-5" },
  spo2: { label: "Oxygen saturation (SpO₂)", unit: "%", loinc: "59408-5" },
  weight: { label: "Weight", unit: "kg", loinc: "29463-7" },
  height: { label: "Height", unit: "cm", loinc: "8302-2" },
  bmi: { label: "Body mass index", unit: "kg/m2", loinc: "39156-5" },
  blood_glucose: { label: "Blood glucose", unit: "mg/dL", loinc: "2339-0" },
  pain_score: { label: "Pain score (0–10)", unit: "{score}", loinc: "72514-3" },
  o2_flow: { label: "Oxygen flow", unit: "L/min", loinc: "3151-8" },
  custom: { label: "Custom observation", unit: "" },
};

const OBSERVATION_ORDER: ObservationType[] = [
  "blood_pressure", "heart_rate", "respiratory_rate", "temperature", "spo2",
  "blood_glucose", "pain_score", "o2_flow", "weight", "height", "bmi", "custom",
];

function abnormalBadge(flag: string): { className: string; label: string } | null {
  switch (flag) {
    case "critical_high":
      return { className: "border-red-300 bg-red-100 text-red-800", label: "Critical high" };
    case "critical_low":
      return { className: "border-red-300 bg-red-100 text-red-800", label: "Critical low" };
    case "high":
      return { className: "border-amber-300 bg-amber-50 text-amber-800", label: "High" };
    case "low":
      return { className: "border-amber-300 bg-amber-50 text-amber-800", label: "Low" };
    case "normal":
      return { className: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "Normal" };
    default:
      return null;
  }
}

function observationValue(observation: ClinicalObservation): string {
  const config = OBSERVATION_CONFIG[observation.observation_type as ObservationType];
  const unit = observation.unit ?? config?.unit ?? "";
  const unitSuffix = unit && unit !== "{score}" ? ` ${unit}` : "";
  if (observation.observation_type === "blood_pressure" && observation.value_numeric != null) {
    const diastolic = observation.value_secondary != null ? `/${observation.value_secondary}` : "";
    return `${observation.value_numeric}${diastolic}${unitSuffix}`;
  }
  if (observation.value_numeric != null) return `${observation.value_numeric}${unitSuffix}`;
  return observation.value_text ?? "—";
}

function observationTitle(observation: ClinicalObservation): string {
  if (observation.observation_type === "custom") {
    return observation.custom_label ?? "Custom observation";
  }
  return OBSERVATION_CONFIG[observation.observation_type as ObservationType]?.label ?? observation.observation_type;
}

type SummaryVital = ClinicalChartSummary["latestVitals"][number];

function summaryVitalTitle(type: string): string {
  return OBSERVATION_CONFIG[type as ObservationType]?.label ?? type.replace(/_/gu, " ");
}

function summaryVitalValue(vital: SummaryVital): string {
  const unit = vital.unit ?? OBSERVATION_CONFIG[vital.observation_type as ObservationType]?.unit ?? "";
  const unitSuffix = unit && unit !== "{score}" ? ` ${unit}` : "";
  if (vital.observation_type === "blood_pressure" && vital.value_numeric != null) {
    const diastolic = vital.value_secondary != null ? `/${vital.value_secondary}` : "";
    return `${vital.value_numeric}${diastolic}${unitSuffix}`;
  }
  if (vital.value_numeric != null) return `${vital.value_numeric}${unitSuffix}`;
  return vital.value_text ?? "—";
}

function titleCase(value: string): string {
  const spaced = value.replace(/_/gu, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default function ResidentClinicalChart() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const resident = useGetResident(id);
  const observations = useResidentClinicalObservations(id);
  const fhir = useResidentFhirClinical(id);
  const summary = useResidentClinicalChartSummary(id, "Resident clinical chart view");

  const activeAllergies = (fhir.data?.allergies ?? []).filter(
    (allergy) => !["inactive", "resolved"].includes(allergy.clinical_status ?? ""),
  );
  const activeMedications = (fhir.data?.medications ?? []).filter((medication) => medication.request_status === "active");

  const residentName = resident.data ? `${resident.data.first_name} ${resident.data.last_name}` : "Resident";
  usePageTitle(`${residentName} · Clinical chart`);

  const canChart = ["platform_admin", "org_admin", "facility_manager", "employee"].includes(user?.role ?? "");

  const [recordOpen, setRecordOpen] = useState(false);
  const [observationType, setObservationType] = useState<ObservationType>("blood_pressure");
  const [valueNumeric, setValueNumeric] = useState("");
  const [valueSecondary, setValueSecondary] = useState("");
  const [valueText, setValueText] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [unit, setUnit] = useState(OBSERVATION_CONFIG.blood_pressure.unit);
  const [observedAt, setObservedAt] = useState(() => toDateTimeLocal(new Date()));
  const [note, setNote] = useState("");
  const record = useRecordClinicalObservation();

  const [retracting, setRetracting] = useState<ClinicalObservation | null>(null);
  const [retractReason, setRetractReason] = useState("");
  const amend = useAmendClinicalObservation();

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
    setObservedAt(toDateTimeLocal(new Date()));
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
        observedAt: new Date(observedAt).toISOString(),
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
          <Button onClick={() => setRecordOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Record observation
          </Button>
        )}
      </div>

      {resident.data && resident.data.clinical_data_consent !== "granted" && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Clinical data consent: {resident.data.clinical_data_consent.replace(/_/gu, " ")}</AlertTitle>
          <AlertDescription>
            Record and share clinical information consistent with this resident&apos;s consent posture and the
            HIPAA minimum-necessary standard. Update the consent status on the resident record when it changes.
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
              {(fhir.data?.allergies ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No allergies on file.</p> : (
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
              {(fhir.data?.conditions ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No diagnoses on file.</p> : (
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
                      </div>
                      <p className="text-2xl font-semibold tabular-nums">{observationValue(observation)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(observation.observed_at).toLocaleString()}
                        {observation.recorded_by_name ? ` · ${observation.recorded_by_name}` : ""}
                      </p>
                      {observation.note && <p className="mt-2 text-sm">{observation.note}</p>}
                    </div>
                    {canChart && (
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setRetracting(observation); setRetractReason(""); }}>
                        <AlertTriangle className="mr-1 h-3.5 w-3.5" />Retract
                      </Button>
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
              <Label>Observation type</Label>
              <Select value={observationType} onValueChange={(value) => chooseType(value as ObservationType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
