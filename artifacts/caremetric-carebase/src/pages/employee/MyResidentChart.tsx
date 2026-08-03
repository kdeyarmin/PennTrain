import { useId, useState } from "react";
import { Link, useParams } from "wouter";
import { AlertTriangle, ArrowLeft, HeartPulse, Plus, ShieldCheck, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/QueryState";
import { ResidentAvatar } from "@/components/residents/ResidentAvatar";
import { ResidentCareDocumentation } from "@/components/residents/ResidentCareDocumentation";
import { useResidentPhotoUrls } from "@/hooks/useResidentPhotos";
import { useToast } from "@/hooks/use-toast";
import {
  type ClinicalObservation,
  type ObservationType,
  useAmendClinicalObservation,
  useRecordClinicalObservation,
  useResidentClinicalChartSummary,
  useResidentClinicalObservations,
} from "@/hooks/useClinicalObservations";
import { useSaveOfflineObservationDraft } from "@/hooks/useOfflineObservationDrafts";
import { isNetworkLevelSupabaseError } from "@/lib/offlineServiceDraftSafety";
import { toDateTimeLocal } from "@/lib/dateUtils";
import { usePageTitle } from "@/lib/pageTitle";
import {
  OBSERVATION_CONFIG,
  OBSERVATION_ORDER,
  QUICK_OBSERVATION_TYPES,
  abnormalBadge,
  isCriticalFlag,
  observationTitle,
  observationValue,
  summaryVitalTitle,
  summaryVitalValue,
} from "@/lib/clinicalObservations";

/**
 * Caregiver clinical charting -- the "future, dedicated caregiver surface" the admin chart's
 * CLINICAL_CHART_ROLES comment anticipates. Every visitor here is already role-gated to
 * `employee` by the route (see App.tsx), so charting is unconditionally allowed -- unlike the
 * admin ResidentClinicalChart, there is no canChart role check to compute. Deliberately narrower
 * than the admin chart: vitals + care notes only, no Medications/Allergies&Diagnoses tabs (those
 * are read-only external data with their own admin surface) -- the one safety-critical exception
 * is the allergy banner below, which comes free from the summary RPC already being fetched.
 */
export default function MyResidentChart() {
  const __fieldIds = useId();
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const summary = useResidentClinicalChartSummary(id, "Caregiver clinical charting");
  const observations = useResidentClinicalObservations(id);
  const saveOffline = useSaveOfflineObservationDraft();
  const photos = useResidentPhotoUrls();

  const residentName = summary.data ? `${summary.data.resident.firstName} ${summary.data.resident.lastName}` : "Resident";
  usePageTitle(`${residentName} · Clinical chart`);

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

  /** A just-recorded reading the server flagged critical -- see the review dialog at the bottom. */
  const [criticalReading, setCriticalReading] = useState<ClinicalObservation | null>(null);

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

  /** Opens the record dialog with one type preselected -- the bedside path (see QUICK_OBSERVATION_TYPES). */
  const openQuickRecord = (type: ObservationType) => {
    resetRecordForm();
    chooseType(type);
    setRecordOpen(true);
  };

  const submitObservation = async () => {
    if (!id) return;
    const numeric = valueNumeric.trim() === "" ? null : Number(valueNumeric);
    if (numeric != null && Number.isNaN(numeric)) {
      toast({ title: "Enter a valid number", variant: "destructive" });
      return;
    }
    const secondary = valueSecondary.trim() === "" ? null : Number(valueSecondary);
    if (secondary != null && Number.isNaN(secondary)) {
      toast({ title: "Enter a valid number", variant: "destructive" });
      return;
    }
    const input = {
      residentId: id,
      observationType,
      observedAt: new Date(observedAt).toISOString(),
      valueNumeric: numeric,
      valueSecondary: secondary,
      valueText: valueText.trim() || null,
      unit: unit.trim() || null,
      customLabel: isCustom ? customLabel.trim() || null : null,
      loincCode: config.loinc ?? null,
      note: note.trim() || null,
    };
    // Only the record call itself may reach the offline fallback below. Anything that runs after it
    // succeeds is post-charting work on a reading the server already holds, and must not be able to
    // queue a draft of it -- that draft would sync on reconnect and chart the SAME vital sign twice,
    // which is the one failure the idempotency key exists to prevent and cannot detect (a second
    // draft carries a second key). refetch() does not reject in this version of react-query, so this
    // is currently unreachable rather than live; the point is that it stays unreachable when someone
    // adds the next await here.
    let observationId: string;
    try {
      observationId = await record.mutateAsync(input);
    } catch (error) {
      // Offline / never-reached-the-server: queue it rather than losing the reading. A real server
      // rejection (wrong facility, capability disabled) still surfaces -- see
      // isNetworkLevelSupabaseError's own note on why an empty error code is the distinguishing mark.
      if (!navigator.onLine || isNetworkLevelSupabaseError(error)) {
        try {
          await saveOffline.mutateAsync({
            residentId: id,
            residentDisplayLabel: summary.data?.resident.room
              ? `${residentName} · Room ${summary.data.resident.room}`
              : residentName,
            observationType: input.observationType,
            observedAt: input.observedAt,
            valueNumeric: input.valueNumeric,
            valueSecondary: input.valueSecondary,
            valueText: input.valueText,
            unit: input.unit,
            customLabel: input.customLabel,
            loincCode: input.loincCode,
            note: input.note,
          });
          setRecordOpen(false);
          resetRecordForm();
          toast({
            title: "Saved on this device",
            description: "No connection right now. This reading syncs once you're back online.",
          });
          return;
        } catch (offlineError) {
          toast({
            title: "Observation could not be saved",
            description: offlineError instanceof Error ? offlineError.message : String(offlineError),
            variant: "destructive",
          });
          return;
        }
      }
      toast({
        title: "Observation could not be recorded",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
      return;
    }

    // Charted. Everything below is read-back and presentation.
    setRecordOpen(false);
    resetRecordForm();
    toast({ title: "Observation recorded" });

    // The abnormal flag is derived server-side, so the only honest way to know whether this reading
    // is critical is to read back what the server actually stored -- no client-side copy of the
    // thresholds to drift out of sync with record_clinical_observation's own logic. A failed
    // read-back costs the caregiver the critical-value prompt, never the reading itself.
    const refreshed = await observations.refetch().catch(() => null);
    const created = (refreshed?.data ?? []).find((entry) => entry.id === observationId);
    if (created && isCriticalFlag(created.abnormal_flag)) setCriticalReading(created);
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

  if (summary.isError) {
    return <QueryError what="resident chart" error={summary.error} onRetry={() => summary.refetch()} />;
  }

  const activeAllergies = summary.data?.allergies ?? [];

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/me/residents" className="mb-1 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-1 h-4 w-4" />Back to resident chart
          </Link>
          <div className="flex items-center gap-3">
            {/* Right-patient verification: the face comes before the chart, not after it. */}
            {summary.data && (
              <ResidentAvatar
                firstName={summary.data.resident.firstName}
                lastName={summary.data.resident.lastName}
                photoUrl={id ? photos.data?.[id] : undefined}
                className="h-14 w-14"
              />
            )}
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                <HeartPulse className="h-6 w-6 text-rose-600" />
                {summary.isLoading ? <Skeleton className="h-7 w-48" /> : residentName}
              </h1>
              {summary.data?.resident.room && <p className="text-muted-foreground">Room {summary.data.resident.room}</p>}
            </div>
          </div>
        </div>
      </div>

      {summary.data && summary.data.resident.clinicalDataConsent !== "granted" && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Clinical data consent: {summary.data.resident.clinicalDataConsent.replace(/_/gu, " ")}</AlertTitle>
          <AlertDescription>
            Record and share clinical information consistent with this resident&apos;s consent posture and the
            HIPAA minimum-necessary standard.
          </AlertDescription>
        </Alert>
      )}

      {activeAllergies.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Allergies</AlertTitle>
          <AlertDescription>
            {activeAllergies
              .map((allergy) => `${allergy.substance}${allergy.criticality ? ` (${allergy.criticality})` : ""}`)
              .join(" · ")}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="vitals">
        <TabsList>
          <TabsTrigger value="vitals">Vitals</TabsTrigger>
          <TabsTrigger value="care">Care notes</TabsTrigger>
        </TabsList>

        <TabsContent value="vitals" className="space-y-3">
          {/* Bedside path: one tap straight to the reading being taken, rather than opening a
              dialog that starts on a twelve-item picker. "Something else" keeps the full list. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {QUICK_OBSERVATION_TYPES.map((type) => (
              <Button
                key={type}
                variant="outline"
                className="h-14 flex-col gap-0.5 text-xs font-semibold"
                onClick={() => openQuickRecord(type)}
              >
                <Plus className="h-4 w-4" />
                {OBSERVATION_CONFIG[type].shortLabel ?? OBSERVATION_CONFIG[type].label}
              </Button>
            ))}
            <Button
              variant="outline"
              className="h-14 flex-col gap-0.5 text-xs font-semibold"
              onClick={() => { resetRecordForm(); setRecordOpen(true); }}
            >
              <Plus className="h-4 w-4" />
              Something else
            </Button>
          </div>

          {summary.isLoading ? (
            <Card><CardContent className="space-y-3 p-4"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-2/3" /></CardContent></Card>
          ) : (summary.data?.latestVitals.length ?? 0) > 0 && (
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

          {observations.isError ? (
            <QueryError what="clinical observations" error={observations.error} onRetry={() => observations.refetch()} />
          ) : observations.isLoading ? (
            <Card><CardContent className="space-y-3 p-4"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-3/4" /></CardContent></Card>
          ) : (observations.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <HeartPulse className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
                <p className="font-medium">No observations recorded</p>
                <p className="text-sm text-muted-foreground">Record the first vital sign or observation for this resident.</p>
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
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => { setRetracting(observation); setRetractReason(""); }}
                    >
                      <AlertTriangle className="mr-1 h-3.5 w-3.5" />Retract
                    </Button>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {id && (
          <TabsContent value="care">
            <ResidentCareDocumentation residentId={id} canChart />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={recordOpen} onOpenChange={(open) => { setRecordOpen(open); if (!open) resetRecordForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isCustom ? "Record observation" : `Record ${config.label.toLowerCase()}`}</DialogTitle>
            <DialogDescription>The abnormal flag is derived automatically once this is saved.</DialogDescription>
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
                <Label htmlFor={`${__fieldIds}-custom-label`}>Observation label</Label>
                <Input
                  id={`${__fieldIds}-custom-label`}
                  value={customLabel}
                  onChange={(event) => setCustomLabel(event.target.value)}
                  placeholder="e.g. Peak flow"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-value`}>{observationType === "blood_pressure" ? "Systolic" : "Value"}</Label>
              <Input
                id={`${__fieldIds}-value`}
                inputMode="decimal"
                autoFocus
                value={valueNumeric}
                onChange={(event) => setValueNumeric(event.target.value)}
                placeholder={isCustom ? "Optional if using text" : ""}
              />
            </div>
            {config.secondaryLabel ? (
              <div className="space-y-2">
                <Label htmlFor={`${__fieldIds}-secondary`}>{config.secondaryLabel}</Label>
                <Input
                  id={`${__fieldIds}-secondary`}
                  inputMode="decimal"
                  value={valueSecondary}
                  onChange={(event) => setValueSecondary(event.target.value)}
                />
              </div>
            ) : isCustom ? (
              <div className="space-y-2">
                <Label htmlFor={`${__fieldIds}-unit`}>Unit</Label>
                <Input id={`${__fieldIds}-unit`} value={unit} onChange={(event) => setUnit(event.target.value)} />
              </div>
            ) : (
              // A known observation type carries its own UCUM unit; showing it as a free-text input
              // only creates a way to record a wrong one at the bedside.
              <div className="space-y-2">
                <span className="text-sm font-medium">Unit</span>
                <p className="flex h-9 items-center text-sm text-muted-foreground">{unit || "—"}</p>
              </div>
            )}
            {isCustom && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor={`${__fieldIds}-text`}>Text value</Label>
                <Input
                  id={`${__fieldIds}-text`}
                  value={valueText}
                  onChange={(event) => setValueText(event.target.value)}
                  placeholder="Optional narrative value"
                />
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${__fieldIds}-observed-at`}>Observed at</Label>
              <Input
                id={`${__fieldIds}-observed-at`}
                type="datetime-local"
                value={observedAt}
                onChange={(event) => setObservedAt(event.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${__fieldIds}-note`}>Note</Label>
              <Textarea id={`${__fieldIds}-note`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional context" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordOpen(false)}>Cancel</Button>
            <Button
              className="h-12"
              disabled={
                record.isPending || saveOffline.isPending
                || (valueNumeric.trim() === "" && valueText.trim() === "")
                || (isCustom && customLabel.trim() === "")
              }
              onClick={() => void submitObservation()}
            >
              {record.isPending || saveOffline.isPending ? "Saving…" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recorded first, reviewed second -- a real reading is never silently discarded, and the
          retraction path below is the append-only way to correct a mistyped one. */}
      <Dialog open={!!criticalReading} onOpenChange={(open) => { if (!open) setCriticalReading(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Check this reading
            </DialogTitle>
            <DialogDescription>
              This value is outside the expected range. It has been recorded — confirm it was entered
              correctly, and escalate if the resident's condition has changed.
            </DialogDescription>
          </DialogHeader>
          {criticalReading && (
            <div className="rounded-lg border p-3">
              <p className="text-sm text-muted-foreground">{observationTitle(criticalReading)}</p>
              <p className="text-3xl font-semibold tabular-nums">{observationValue(criticalReading)}</p>
              {abnormalBadge(criticalReading.abnormal_flag) && (
                <Badge variant="outline" className={`mt-1 ${abnormalBadge(criticalReading.abnormal_flag)!.className}`}>
                  {abnormalBadge(criticalReading.abnormal_flag)!.label}
                </Badge>
              )}
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="h-12"
              onClick={() => {
                setRetracting(criticalReading);
                setRetractReason("");
                setCriticalReading(null);
              }}
            >
              I mistyped it
            </Button>
            <Button className="h-12" asChild>
              <Link href={`/me/change-of-condition?resident=${id}`}>Report a change of condition</Link>
            </Button>
            <Button variant="ghost" className="h-12" onClick={() => setCriticalReading(null)}>
              The reading is correct
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
            <Label htmlFor={`${__fieldIds}-retract-reason`}>Reason</Label>
            <Textarea
              id={`${__fieldIds}-retract-reason`}
              value={retractReason}
              onChange={(event) => setRetractReason(event.target.value)}
              placeholder="Why is this observation being retracted?"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRetracting(null); setRetractReason(""); }}>Cancel</Button>
            <Button variant="destructive" disabled={amend.isPending || retractReason.trim().length < 3} onClick={() => void submitRetraction()}>
              {amend.isPending ? "Saving…" : "Retract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {saveOffline.isSuccess && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <WifiOff className="h-3.5 w-3.5" />
          Readings saved on this device are listed on the resident chart list and on Floor until they sync.
        </p>
      )}
    </div>
  );
}
