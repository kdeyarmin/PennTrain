import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Bot, CheckCircle2, ClipboardList, ExternalLink, FileSearch, History, Loader2, LockKeyhole, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListViolations } from "@/hooks/useViolations";
import {
  useAskComplianceCopilot,
  useComplianceCopilotHistory,
  type CopilotResult as CopilotResultData,
  type CopilotEvidence,
  type CopilotIntent,
  type CopilotRuleSource,
} from "@/hooks/useComplianceCopilot";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCreateCopilotActionDraft } from "@/hooks/useProductValueOperatingSystem";

const INTENTS: Array<{ value: CopilotIntent; label: string; question: string; help: string }> = [
  { value: "employee_blocked", label: "Why is this employee blocked?", question: "Explain the latest recorded scheduling eligibility decision for this employee.", help: "Uses recorded blocks, warnings, overrides, and decision checksum only." },
  { value: "due_next_30_days", label: "What is due in 30 days?", question: "What compliance work is due in the next 30 days?", help: "Training, credentials, resident compliance, inspections, and work items." },
  { value: "missing_medical_evaluations", label: "Missing medical evaluations", question: "Which residents are missing a current medical evaluation?", help: "Uses the resident compliance registry without changing resident records." },
  { value: "citation_evidence", label: "Show citation documentation", question: "Show me the system documentation for this citation or regulatory topic.", help: "Matches governed sources, citation topics, and linked documentation rows." },
  { value: "recurring_citations", label: "Prior citations that may recur", question: "Which prior citations may recur based on recorded facility history?", help: "Shows recorded frequency and open history; it does not predict regulator action." },
  { value: "readiness_score", label: "Explain readiness score", question: "Why is this facility’s readiness score low?", help: "Uses the current citation-topic breakdown and labeled planning weights." },
  { value: "draft_plan_of_correction", label: "Draft a Plan of Correction", question: "Draft a Plan of Correction from the selected verified finding and recorded corrective actions.", help: "Draft recommendation only; it is never approved or submitted automatically." },
  { value: "mock_survey_request", label: "Mock-survey request", question: "Create a mock-survey document request from current due work and readiness gaps.", help: "Draft request only; documentation remains in its source modules." },
  { value: "overdue_support_plans", label: "Overdue support plans", question: "Which support plans are overdue?", help: "Uses open support-plan compliance cycles and their recorded due dates." },
  { value: "effectiveness_reviews", label: "Effectiveness reviews due", question: "Which corrective actions still require an effectiveness review?", help: "Uses closed work items with a due review and no recorded result." },
];

// Intent keyword hints for the floating guide's hand-off (?q=...). The widget hands off the user's
// raw question and cannot know this copilot's intent taxonomy, so infer the closest intent here --
// otherwise a Plan-of-Correction, citation, or eligibility question would submit under the default
// "due in 30 days" intent and the Edge function would select the wrong evidence/context. An
// explicit ?intent= wins when valid. Ordered most-specific first; the first keyword match wins.
const INTENT_HINTS: Array<{ intent: CopilotIntent; keywords: string[] }> = [
  { intent: "draft_plan_of_correction", keywords: ["plan of correction", "poc"] },
  { intent: "citation_evidence", keywords: ["citation documentation", "documentation for", "system documentation"] },
  { intent: "recurring_citations", keywords: ["recur", "prior citation"] },
  { intent: "readiness_score", keywords: ["readiness score", "score low", "why is this facility"] },
  { intent: "mock_survey_request", keywords: ["mock survey", "mock-survey", "document request"] },
  { intent: "missing_medical_evaluations", keywords: ["medical evaluation"] },
  { intent: "overdue_support_plans", keywords: ["support plan"] },
  { intent: "effectiveness_reviews", keywords: ["effectiveness review"] },
  { intent: "employee_blocked", keywords: ["why is this employee", "eligibility", "blocked"] },
];

function resolveHandoffIntent(): CopilotIntent {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("intent");
  if (explicit && INTENTS.some((option) => option.value === explicit)) return explicit as CopilotIntent;
  // Normalize punctuation to spaces before matching so hyphenated hand-offs ("Plan-of-Correction")
  // match the space-separated keywords, while the word-boundary test below still rejects
  // substrings ("poc" vs "pocket").
  const q = (params.get("q") ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (q.length >= 3) {
    // Whole-token/phrase match (word boundaries) rather than raw substring, so a short abbreviation
    // like "poc" matches "poc" but not "pocket"/"epoch".
    const hit = INTENT_HINTS.find((h) => h.keywords.some((keyword) => {
      const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      return pattern.test(q);
    }));
    if (hit) return hit.intent;
  }
  return "due_next_30_days";
}

function safeSourceUrl(value: string | null) {
  return value && /^https:\/\//i.test(value) ? value : null;
}

function displayDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString([], value.length === 10 ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" });
}

export default function RegulatoryCopilot() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [facilityId, setFacilityId] = useState("");
  // Intent is inferred from the hand-off (?intent= or the ?q= question) so a prefilled question
  // submits under the right intent instead of the default; falls back to "due in 30 days".
  const [intent, setIntent] = useState<CopilotIntent>(resolveHandoffIntent);
  // Accept a question prefilled by the floating guide's hand-off (?q=...); it wins over the
  // default intent question on first render, then normal intent-syncing resumes.
  const [question, setQuestion] = useState(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    return q && q.trim().length >= 3 ? q.trim().slice(0, 2000) : INTENTS[1].question;
  });
  const skipNextIntentSync = useRef(new URLSearchParams(window.location.search).has("q"));
  const [employeeId, setEmployeeId] = useState("");
  const [violationId, setViolationId] = useState("");
  const [citationQuery, setCitationQuery] = useState("");
  const [asOfDate, setAsOfDate] = useState(toLocalIsoDate());

  const { data: facilities } = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const activeFacilityId = facilityId || facilities?.[0]?.id || "";
  const { data: employees } = useListEmployees({ facilityId: activeFacilityId || undefined });
  const { data: violations } = useListViolations({ facilityId: activeFacilityId || undefined });
  const history = useComplianceCopilotHistory(activeFacilityId || undefined);
  const ask = useAskComplianceCopilot();
  const createActionDraft = useCreateCopilotActionDraft();
  const selectedIntent = INTENTS.find((option) => option.value === intent)!;

  useEffect(() => {
    if (skipNextIntentSync.current) { skipNextIntentSync.current = false; return; }
    setQuestion(selectedIntent.question);
  }, [selectedIntent.question]);
  const needsContext = (intent === "employee_blocked" && !employeeId)
    || (intent === "draft_plan_of_correction" && !violationId)
    || (intent === "citation_evidence" && citationQuery.trim().length < 2);
  const evidenceById = useMemo(() => new Map((ask.data?.evidenceUsed ?? []).map((item) => [item.id, item])), [ask.data]);

  const submit = () => ask.mutate({
    facilityId: activeFacilityId,
    intent,
    question: question.trim(),
    employeeId: intent === "employee_blocked" ? employeeId : undefined,
    violationId: intent === "draft_plan_of_correction" ? violationId : undefined,
    citationQuery: intent === "citation_evidence" ? citationQuery.trim() : undefined,
    asOfDate,
  }, {
    onError: (error: Error) => toast({ title: "Compliance copilot could not answer", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2"><Bot className="h-6 w-6" /><h1 className="text-2xl font-bold tracking-tight">Citation-Backed Regulatory Copilot</h1></div>
        <p className="text-muted-foreground">Read-only synthesis over governed rule versions and facility-scoped CareBase documentation. Every answer carries its source, effective date, rule-pack version, documentation links, gaps, and authority label.</p>
      </div>

      <Alert>
        <LockKeyhole className="h-4 w-4" />
        <AlertTitle>Human confirmation remains mandatory</AlertTitle>
        <AlertDescription>The copilot cannot close findings, approve plans, change resident records, decide incident reportability, invent citations, use superseded rules as current, or alter staffing eligibility.</AlertDescription>
      </Alert>

      <Tabs defaultValue="ask">
        <TabsList><TabsTrigger value="ask"><Sparkles className="mr-2 h-4 w-4" />Ask</TabsTrigger><TabsTrigger value="history"><History className="mr-2 h-4 w-4" />Immutable history</TabsTrigger></TabsList>
        <TabsContent value="ask" className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Grounded question</CardTitle><CardDescription>{selectedIntent.help}</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label>Facility</Label><Select value={activeFacilityId} onValueChange={setFacilityId}><SelectTrigger><SelectValue placeholder="Select facility" /></SelectTrigger><SelectContent>{(facilities ?? []).map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>As-of date</Label><Input type="date" value={asOfDate} max={toLocalIsoDate()} onChange={(event) => setAsOfDate(event.target.value)} /></div>
              <div className="space-y-2 md:col-span-2"><Label>Supported question</Label><Select value={intent} onValueChange={(value) => { setIntent(value as CopilotIntent); ask.reset(); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{INTENTS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
              {intent === "employee_blocked" && <div className="space-y-2 md:col-span-2"><Label>Employee</Label><Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger><SelectContent>{(employees ?? []).map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name} — {employee.job_title}</SelectItem>)}</SelectContent></Select></div>}
              {intent === "draft_plan_of_correction" && <div className="space-y-2 md:col-span-2"><Label>Verified finding / violation</Label><Select value={violationId} onValueChange={setViolationId}><SelectTrigger><SelectValue placeholder="Select violation" /></SelectTrigger><SelectContent>{(violations ?? []).map((violation) => <SelectItem key={violation.id} value={violation.id}>{violation.citation_ref ?? "Unnumbered finding"} — {violation.description.slice(0, 90)}</SelectItem>)}</SelectContent></Select></div>}
              {intent === "citation_evidence" && <div className="space-y-2 md:col-span-2"><Label>Citation or regulatory topic</Label><Input value={citationQuery} onChange={(event) => setCitationQuery(event.target.value)} placeholder="Example: 2600.227 or resident support plan" /></div>}
              <div className="space-y-2 md:col-span-2"><Label>Question</Label><Textarea rows={4} value={question} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} /></div>
              <div className="md:col-span-2"><Button onClick={submit} disabled={!activeFacilityId || needsContext || question.trim().length < 3 || ask.isPending}>{ask.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Grounding and validating…</> : <><Sparkles className="mr-2 h-4 w-4" />Generate grounded response</>}</Button></div>
            </CardContent>
          </Card>

          {ask.data && <CopilotResult
            result={ask.data}
            evidenceById={evidenceById}
            canCreateDraft={["org_admin", "facility_manager"].includes(user?.role ?? "") && ask.data.response.recommended_next_steps.length > 0}
            creatingDraft={createActionDraft.isPending}
            onCreateDraft={() => createActionDraft.mutate({
              facilityId: activeFacilityId,
              intent: ask.data!.intent,
              title: `Copilot follow-up: ${INTENTS.find((item) => item.value === ask.data!.intent)?.label ?? "compliance review"}`,
              sourceResponseId: ask.data!.runId,
              actions: ask.data!.response.recommended_next_steps.map((step) => ({ title: step, description: "Human-approved follow-up from a citation-backed CareBase response.", priority: "normal", dueDays: 7 })),
            }, {
              onSuccess: () => toast({ title: "Governed action draft created", description: "Review and approve it in the CareBase Value Center before work is created." }),
              onError: (error) => toast({ title: "Action draft could not be created", description: error.message, variant: "destructive" }),
            })}
          />}
        </TabsContent>
        <TabsContent value="history">
          <Card><CardHeader><CardTitle>Immutable response receipts</CardTitle><CardDescription>History includes failed attempts, request/response checksums, the facility scope, model, determination label, and cited snapshots. Prior rows cannot be edited or deleted.</CardDescription></CardHeader><CardContent className="space-y-3">
            {history.isLoading ? <p className="text-sm text-muted-foreground">Loading history…</p> : (history.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No copilot history for this facility.</p> : (history.data ?? []).map((run) => <div key={run.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{run.question}</p><p className="text-xs text-muted-foreground">{displayDate(run.created_at)} · {run.intent.replaceAll("_", " ")} · as of {run.as_of_date}</p></div><div className="flex gap-2"><Badge variant={run.status === "completed" ? "secondary" : "destructive"}>{run.status}</Badge><Badge variant="outline">{run.determination_kind.replaceAll("_", " ")}</Badge></div></div>{run.error_message && <p className="mt-2 text-sm text-destructive">{run.error_message}</p>}<p className="mt-2 break-all text-[11px] text-muted-foreground">Request SHA-256: {run.request_checksum_sha256}{run.response_checksum_sha256 ? ` · Response SHA-256: ${run.response_checksum_sha256}` : ""}</p></div>)}</CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CopilotResult({ result, evidenceById, canCreateDraft, creatingDraft, onCreateDraft }: { result: CopilotResultData; evidenceById: Map<string, CopilotEvidence>; canCreateDraft: boolean; creatingDraft: boolean; onCreateDraft: () => void }) {
  const recommendation = result.determinationKind === "recommendation";
  return <div className="space-y-5">
    <Alert variant={recommendation ? "default" : undefined}>{recommendation ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}<AlertTitle>{recommendation ? "Recommendation — human review required" : "Confirmed system snapshot — human interpretation still required"}</AlertTitle><AlertDescription>{result.jurisdictionCode} · {result.facilityType === "ALR" ? "ALF" : result.facilityType} · as of {result.asOfDate} · model {result.model}</AlertDescription></Alert>
    <Card><CardHeader><CardTitle>Answer</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm leading-6">{result.response.answer}</p></CardContent></Card>
    {result.response.findings.length > 0 && <Card><CardHeader><CardTitle>Grounded findings</CardTitle></CardHeader><CardContent className="space-y-3">{result.response.findings.map((finding, index) => <div key={`${finding.title}-${index}`} className="rounded-lg border p-3"><p className="font-medium">{finding.title}</p><p className="mt-1 text-sm text-muted-foreground">{finding.detail}</p><div className="mt-2 flex flex-wrap gap-2">{finding.evidence_ids.map((id) => { const item = evidenceById.get(id); return item ? <Button key={id} asChild variant="outline" size="sm"><Link href={item.route}>{item.label}<ExternalLink className="ml-2 h-3 w-3" /></Link></Button> : null; })}</div></div>)}</CardContent></Card>}
    <div className="grid gap-5 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Regulatory sources</CardTitle><CardDescription>Only exact governed rule versions validated against the model’s source IDs.</CardDescription></CardHeader><CardContent className="space-y-3">{result.ruleSources.length === 0 ? <p className="text-sm text-muted-foreground">No matching active governed rule version was available; see missing information.</p> : result.ruleSources.map((source) => <RuleSource key={source.id} source={source} />)}</CardContent></Card>
      <Card><CardHeader><CardTitle>Documentation used</CardTitle><CardDescription>Facility-scoped rows retrieved under the caller’s own access policy.</CardDescription></CardHeader><CardContent className="space-y-2">{result.evidenceUsed.length === 0 ? <p className="text-sm text-muted-foreground">No matching documentation was found.</p> : result.evidenceUsed.map((item) => <Button key={item.id} asChild variant="outline" className="h-auto w-full justify-between py-2 text-left"><Link href={item.route}><span><span className="block font-medium">{item.label}</span><span className="block text-xs text-muted-foreground">{item.status ?? "No status"} · due {displayDate(item.dueOn)}</span></span><ExternalLink className="h-4 w-4 shrink-0" /></Link></Button>)}</CardContent></Card>
    </div>
    <div className="grid gap-5 xl:grid-cols-2"><Card><CardHeader><CardTitle>Missing information</CardTitle></CardHeader><CardContent>{result.response.missing_information.length === 0 ? <p className="text-sm text-muted-foreground">No material data gap was reported.</p> : <ul className="list-disc space-y-1 pl-5 text-sm">{result.response.missing_information.map((item) => <li key={item}>{item}</li>)}</ul>}</CardContent></Card><Card><CardHeader><CardTitle>Recommended next steps</CardTitle></CardHeader><CardContent className="space-y-4">{result.response.recommended_next_steps.length === 0 ? <p className="text-sm text-muted-foreground">No next step was proposed.</p> : <><ol className="list-decimal space-y-1 pl-5 text-sm">{result.response.recommended_next_steps.map((item) => <li key={item}>{item}</li>)}</ol>{canCreateDraft && <Button variant="outline" disabled={creatingDraft} onClick={onCreateDraft}>{creatingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardList className="mr-2 h-4 w-4" />}Create governed action draft</Button>}</>}</CardContent></Card></div>
    <Alert><FileSearch className="h-4 w-4" /><AlertTitle>Safeguards applied</AlertTitle><AlertDescription>Read-only: {String(result.safeguards.readOnly)} · Human confirmation required: {String(result.safeguards.humanConfirmationRequired)} · Prohibited actions: {result.safeguards.prohibitedActions.join(", ").replaceAll("_", " ")}.</AlertDescription></Alert>
  </div>;
}

function RuleSource({ source }: { source: CopilotRuleSource }) {
  const url = safeSourceUrl(source.sourceUri);
  return <div className="rounded-lg border p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><Badge variant="outline">{source.citation}</Badge><p className="mt-2 font-medium">{source.rulePackName} · version {source.versionNumber}</p><p className="text-xs text-muted-foreground">{source.jurisdictionCode} · {source.authorityName} · effective {displayDate(source.effectiveFrom)}{source.effectiveTo ? ` through ${displayDate(source.effectiveTo)}` : ""}</p></div>{url && <Button asChild variant="outline" size="sm"><a href={url} target="_blank" rel="noreferrer">Regulatory source<ExternalLink className="ml-2 h-3 w-3" /></a></Button>}</div>{!url && <p className="mt-2 text-xs text-amber-700">No HTTPS source URI is recorded for this governed rule version.</p>}<p className="mt-2 break-all text-[11px] text-muted-foreground">Source SHA-256: {source.sourceChecksumSha256} · Content SHA-256: {source.contentChecksumSha256}</p></div>;
}
