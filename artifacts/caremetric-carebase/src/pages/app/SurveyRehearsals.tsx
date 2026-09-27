import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ClipboardCheck, FlaskConical, Play, CheckCircle2, Ban } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PCH_ALR_ONLY_FACILITY_TYPES } from "@/lib/facilityTypes";
import { useListFacilities } from "@/hooks/useFacilities";
import {
  useCancelSurveyRehearsal,
  useCompleteSurveyRehearsal,
  useCreateSurveyRehearsal,
  useListSurveyRehearsals,
  useRecordSurveyRehearsalItemResult,
  useSampleSurveyRehearsal,
  useSurveyRehearsalItems,
  type SurveyRehearsal,
} from "@/hooks/useSurveyRehearsals";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "canceled") return "destructive";
  if (status === "in_progress" || status === "sampled") return "secondary";
  return "outline";
}

export default function SurveyRehearsals() {
  const __fieldIds = useId();
  const { user } = useAuth();
  const { toast } = useToast();
  const facilities = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const supportedFacilities = (facilities.data ?? []).filter((facility) => (PCH_ALR_ONLY_FACILITY_TYPES as readonly string[]).includes(facility.facility_type));
  const [facilityId, setFacilityId] = useState("");
  const activeFacilityId = supportedFacilities.find((facility) => facility.id === facilityId)?.id || supportedFacilities[0]?.id || "";
  const rehearsals = useListSurveyRehearsals(activeFacilityId || undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const create = useCreateSurveyRehearsal();
  const sample = useSampleSurveyRehearsal();
  const record = useRecordSurveyRehearsalItemResult();
  const complete = useCompleteSurveyRehearsal();
  const cancel = useCancelSurveyRehearsal();

  // BACKLOG J74. This route admits auditors (REPORTS_VIEW_ROLES in App.tsx) and every write on the
  // page goes through an RPC guarded by app_private.assert_admission_manager, which admits only
  // org_admin and facility_manager (and the service role / platform admins). So an auditor was
  // offered "Create rehearsal", "Draw sample", "Complete", "Cancel" and the three per-item result
  // buttons, and each one came back "Admission operation is outside caller scope" -- a 42501 with
  // nothing on the page explaining it. Auditors read a rehearsal; they do not run one.
  const canRunRehearsals = ["org_admin", "facility_manager", "platform_admin"].includes(user?.role ?? "");

  const [name, setName] = useState("Mock survey readiness rehearsal");
  const [sampleSize, setSampleSize] = useState("12");
  const [sampleMethod, setSampleMethod] = useState("random");
  const [notes, setNotes] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const busy = useRef(false);
  const selection = useRef({ key: "", generation: 0 });
  const selectionKey = `${activeFacilityId}:${selectedId}`;
  if (selection.current.key !== selectionKey) selection.current = { key: selectionKey, generation: selection.current.generation + 1 };
  const operationPending = create.isPending || sample.isPending || record.isPending || complete.isPending || cancel.isPending;
  const validSampleSize = Number.isInteger(Number(sampleSize)) && Number(sampleSize) >= 1 && Number(sampleSize) <= 200;

  const selected = useMemo(
    () => rehearsals.isError ? null : (rehearsals.data ?? []).find((row) => row.id === selectedId && row.facility_id === activeFacilityId) ?? null,
    [rehearsals.data, rehearsals.isError, selectedId, activeFacilityId],
  );
  const items = useSurveyRehearsalItems(selected?.id ?? null);
  useEffect(() => { setCompletionNotes(selected?.notes ?? ""); }, [selected?.id]);
  const begin = () => {
    if (!canRunRehearsals || busy.current || operationPending) return false;
    busy.current = true; return true;
  };

  const start = async () => {
    if (!activeFacilityId || !validSampleSize || name.trim().length < 3 || !begin()) return;
    const generation = selection.current.generation;
    try {
      const id = await create.mutateAsync({
        facilityId: activeFacilityId,
        name: name.trim(),
        sampleSize: Number(sampleSize),
        sampleMethod,
        notes: notes.trim() || null,
      });
      if (selection.current.generation === generation) setSelectedId(id);
      toast({ title: "Rehearsal created" });
    } catch (error) {
      toast({
        title: "Could not create rehearsal",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally { busy.current = false; }
  };

  const runSample = async (rehearsal: SurveyRehearsal) => {
    if (rehearsal.id !== selected?.id || !["draft", "sampled"].includes(rehearsal.status) || !begin()) return;
    const generation = selection.current.generation;
    try {
      const result = await sample.mutateAsync(rehearsal.id);
      if (selection.current.generation === generation) setSelectedId(rehearsal.id);
      toast({
        title: "Sample drawn",
        description: `${String(result.itemCount ?? 0)} items ready for review`,
      });
    } catch (error) {
      toast({
        title: "Sampling blocked",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally { busy.current = false; }
  };

  const markItem = async (itemId: string, result: string) => {
    if (!selected || ["completed", "canceled"].includes(selected.status) || items.isError || !items.data?.some(item => item.id === itemId) || !begin()) return;
    try {
      await record.mutateAsync({ itemId, result, rehearsalId: selected.id });
    } catch (error) {
      toast({
        title: "Could not record finding",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally { busy.current = false; }
  };

  const finish = async () => {
    if (!selected || !["sampled", "in_progress"].includes(selected.status) || items.isError || items.isLoading || !items.data?.length || items.data.some(item => item.result === "pending") || !begin()) return;
    try {
      const report = await complete.mutateAsync({ rehearsalId: selected.id, notes: completionNotes.trim() || undefined });
      toast({
        title: "Rehearsal completed",
        description: `Pass rate ${String(report.passRate ?? "—")}% · ${String(report.attentionCount ?? 0)} attention items`,
      });
    } catch (error) {
      toast({
        title: "Completion blocked",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally { busy.current = false; }
  };

  const abort = async () => {
    if (!selected || ["completed", "canceled"].includes(selected.status) || busy.current || operationPending || !canRunRehearsals) return;
    const reason = window.prompt("Cancellation reason (required)");
    if (!reason || reason.trim().length < 3 || !begin()) return;
    try {
      await cancel.mutateAsync({ rehearsalId: selected.id, reason: reason.trim() });
      toast({ title: "Rehearsal canceled" });
    } catch (error) {
      toast({
        title: "Cancel blocked",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally { busy.current = false; }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-primary">Survey readiness</p>
        <h1 className="text-2xl font-bold tracking-tight">Survey rehearsal & random sampling</h1>
        <p className="max-w-3xl text-muted-foreground">
          Run a mock survey against a random or high-risk sample of live credentials, training, incidents, and work
          items. Record pass/attention findings and generate a completion report before the real survey day.
        </p>
      </header>

      {!canRunRehearsals && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" /> Review only
            </CardTitle>
            <CardDescription>
              Rehearsals are created, sampled, scored and completed by facility managers and organization
              administrators. Every rehearsal and its findings are readable here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* The facility picker lives in the create card below, which this role does not get. */}
            <div className="max-w-sm space-y-2">
              <Label htmlFor={`${__fieldIds}-review-facility`}>Facility</Label>
              <Select value={activeFacilityId} onValueChange={(nextFacilityId) => { setSelectedId(null); setFacilityId(nextFacilityId); }}>
                <SelectTrigger id={`${__fieldIds}-review-facility`}>
                  <SelectValue placeholder="Select facility" />
                </SelectTrigger>
                <SelectContent>
                  {supportedFacilities.map((facility) => (
                    <SelectItem key={facility.id} value={facility.id}>
                      {facility.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {canRunRehearsals && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" /> Start a rehearsal
          </CardTitle>
          <CardDescription>Managers create a draft, draw a sample, walk each item, then complete the report.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${__fieldIds}-facility`}>Facility</Label>
            <Select value={activeFacilityId} onValueChange={(nextFacilityId) => { setSelectedId(null); setFacilityId(nextFacilityId); }}>
              <SelectTrigger id={`${__fieldIds}-facility`}>
                <SelectValue placeholder="Select facility" />
              </SelectTrigger>
              <SelectContent>
                {supportedFacilities.map((facility) => (
                  <SelectItem key={facility.id} value={facility.id}>
                    {facility.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rehearsal-name">Name</Label>
            <Input id="rehearsal-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sample-size">Sample size</Label>
            <Input
              id="sample-size"
              type="number"
              min={1}
              max={200}
              value={sampleSize}
              onChange={(e) => setSampleSize(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${__fieldIds}-sample-method`}>Sample method</Label>
            <Select value={sampleMethod} onValueChange={setSampleMethod}>
              <SelectTrigger id={`${__fieldIds}-sample-method`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="random">Random</SelectItem>
                <SelectItem value="high_risk">High risk first</SelectItem>
                <SelectItem value="manual">Manual (empty shell)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="rehearsal-notes">Notes</Label>
            <Textarea id="rehearsal-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="md:col-span-2">
            <Button disabled={!activeFacilityId || operationPending || !validSampleSize || name.trim().length < 3} onClick={() => void start()}>
              {create.isPending ? "Creating…" : "Create rehearsal"}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Rehearsal history</CardTitle>
            <CardDescription>Up to 100 most recent rehearsals for the selected facility.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rehearsals.isLoading ? (
              <QueryLoading what="survey rehearsals" />
            ) : rehearsals.isError ? (
              <QueryError what="survey rehearsals" error={rehearsals.error} onRetry={() => rehearsals.refetch()} />
            ) : (rehearsals.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No rehearsals yet for this facility.</p>
            ) : (
              (rehearsals.data ?? []).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`w-full rounded-lg border p-3 text-left ${selectedId === row.id ? "border-primary" : ""}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateForDisplay(row.created_at)} · {row.sample_method} · size {row.sample_size}
                      </p>
                    </div>
                    <Badge variant={statusVariant(row.status)}>{label(row.status)}</Badge>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5" /> Sample review
                </CardTitle>
                <CardDescription>
                  {selected
                    ? `${label(selected.status)} · ${selected.sample_method} sample of ${selected.sample_size}`
                    : "Select a rehearsal to draw and score its sample."}
                </CardDescription>
              </div>
              {canRunRehearsals && selected && !["completed", "canceled"].includes(selected.status) && (
                <div className="flex flex-wrap gap-2">
                  {["draft", "sampled"].includes(selected.status) && (
                    <Button size="sm" variant="outline" disabled={operationPending} onClick={() => void runSample(selected)}>
                      <Play className="mr-2 h-4 w-4" /> {sample.isPending ? "Sampling…" : "Draw sample"}
                    </Button>
                  )}
                  {["sampled", "in_progress"].includes(selected.status) && (
                    <Button size="sm" disabled={operationPending || items.isError || items.isLoading || !items.data?.length || items.data.some(item => item.result === "pending")} onClick={() => void finish()}>
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Complete
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" disabled={operationPending} onClick={() => void abort()}>
                    <Ban className="mr-2 h-4 w-4" /> Cancel
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {selected && canRunRehearsals && !["completed", "canceled"].includes(selected.status) && <div className="space-y-2"><Label htmlFor="rehearsal-completion-notes">Completion notes for this rehearsal</Label><Textarea id="rehearsal-completion-notes" value={completionNotes} disabled={operationPending} onChange={event => setCompletionNotes(event.target.value)} /></div>}
            {!selected ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No rehearsal selected.</p>
            ) : items.isLoading ? (
              <QueryLoading what="sample items" />
            ) : items.isError ? (
              <QueryError what="sample items" error={items.error} onRetry={() => items.refetch()} />
            ) : (items.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No sample items yet. Draw a sample to pull live credentials, training, incidents, and open work.
              </p>
            ) : (
              (items.data ?? []).map((item) => (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{item.source_label}</p>
                      <p className="text-xs text-muted-foreground">
                        {label(item.domain)} · {label(item.risk_tier)} risk
                      </p>
                      {item.finding && <p className="mt-1 text-sm text-muted-foreground">{item.finding}</p>}
                    </div>
                    <Badge variant={item.result === "attention" ? "destructive" : "secondary"}>{label(item.result)}</Badge>
                  </div>
                  {canRunRehearsals && !["completed", "canceled"].includes(selected.status) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["pass", "attention", "not_applicable"].map((result) => (
                        <Button
                          key={result}
                          size="sm"
                          variant={item.result === result ? "default" : "outline"}
                          disabled={operationPending}
                          onClick={() => void markItem(item.id, result)}
                        >
                          {label(result)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}

            {selected?.status === "completed" && selected.report && (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <p className="font-medium">Completion report</p>
                <p className="mt-1 text-muted-foreground">
                  {String(selected.report.passCount ?? 0)} pass · {String(selected.report.attentionCount ?? 0)} attention ·{" "}
                  {String(selected.report.passRate ?? "—")}% pass rate
                </p>
                {typeof selected.report.notes === "string" && selected.report.notes && (
                  <p className="mt-2">{selected.report.notes}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
