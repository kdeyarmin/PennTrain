import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Activity, AlertTriangle, BarChart3, BedDouble, Bot, Cable, CalendarClock, CheckCircle2,
  CircleDollarSign, ClipboardCheck, CloudOff, FolderKanban, Loader2, Play, Plus, Radar,
  RefreshCw, RotateCcw, Save, ShieldCheck, Sparkles, Users,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { ReportScheduleManager } from "@/components/value-center/ReportScheduleManager";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_CUSTOMER_VALUE_BASELINE,
  customerValueBaselineToInput,
  customerValueBaselinesMatch,
  customerValueDashboardToForm,
  isCustomerValueBaselineValid,
  type CustomerValueBaselineForm,
} from "@/lib/customerValueBaseline";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { useToast } from "@/hooks/use-toast";
import { useListFacilities } from "@/hooks/useFacilities";
import {
  useAddWarRoomRequest,
  useAdmissionsIntelligence,
  useCreateInspectionWarRoom,
  useCustomerValueDashboard,
  useInitializeImplementationProject,
  useProductValueWorkspace,
  useReviewCopilotActionDraft,
  useRunWorkflowAutomation,
  useSaveCustomerValueBaseline,
  useSaveWorkflowAutomation,
  useStaffingOptimization,
  useUpdateImplementationTask,
  useUpdateWarRoomRequest,
} from "@/hooks/useProductValueOperatingSystem";

function human(value: unknown) {
  return String(value ?? "").replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function number(value: unknown) {
  return Number(value ?? 0).toLocaleString();
}

function money(value: unknown) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail?: string; icon: typeof Activity }) {
  return <Card><CardHeader className="pb-2"><div className="flex items-center justify-between"><CardDescription>{label}</CardDescription><Icon className="h-4 w-4 text-muted-foreground" /></div><CardTitle className="text-3xl">{value}</CardTitle></CardHeader>{detail && <CardContent className="pt-0 text-xs text-muted-foreground">{detail}</CardContent>}</Card>;
}

function Empty({ children }: { children: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export default function ValueCenter() {
  const { user } = useAuth();
  const { toast } = useToast();
  const facilities = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const [selectedFacilityId, setSelectedFacilityId] = useState("");
  const facilityId = selectedFacilityId || facilities.data?.[0]?.id || "";
  const today = toLocalIsoDate(new Date());
  const through = useMemo(() => {
    const date = new Date(); date.setDate(date.getDate() + 30); return toLocalIsoDate(date);
  }, []);
  const workspace = useProductValueWorkspace(facilityId || undefined);
  const value = useCustomerValueDashboard(user?.organizationId ?? undefined);
  const staffing = useStaffingOptimization(facilityId || undefined, today, through);
  const admissions = useAdmissionsIntelligence(facilityId || undefined);

  const [automationName, setAutomationName] = useState("Critical compliance follow-up");
  const [automationTrigger, setAutomationTrigger] = useState("alert_created");
  const [automationPriority, setAutomationPriority] = useState<"normal" | "high" | "urgent">("high");
  const saveAutomation = useSaveWorkflowAutomation();
  const runAutomation = useRunWorkflowAutomation();
  const [warRoomName, setWarRoomName] = useState("Upcoming inspection response");
  const createWarRoom = useCreateInspectionWarRoom();
  const addWarRoomRequest = useAddWarRoomRequest();
  const updateWarRoomRequest = useUpdateWarRoomRequest();
  const [projectName, setProjectName] = useState("CareBase implementation");
  const initializeProject = useInitializeImplementationProject();
  const updateImplementationTask = useUpdateImplementationTask();
  const [baselineForm, setBaselineForm] = useState<CustomerValueBaselineForm>({ ...DEFAULT_CUSTOMER_VALUE_BASELINE });
  const [savedBaselineForm, setSavedBaselineForm] = useState<CustomerValueBaselineForm | null>(null);
  const [baselineConfigured, setBaselineConfigured] = useState(false);
  const [hydratedBaselineScope, setHydratedBaselineScope] = useState("");
  const [hydratedBaselineVersion, setHydratedBaselineVersion] = useState("");
  const saveBaseline = useSaveCustomerValueBaseline();
  const reviewDraft = useReviewCopilotActionDraft();

  const data = workspace.data;
  const notify = async (action: () => Promise<unknown>, title: string) => {
    try { await action(); toast({ title }); }
    catch (error) { toast({ title: "Action could not be completed", description: error instanceof Error ? error.message : String(error), variant: "destructive" }); }
  };

  const baselineDirty = savedBaselineForm !== null
    && (!baselineConfigured || !customerValueBaselinesMatch(baselineForm, savedBaselineForm));
  const baselineScope = user?.organizationId ?? "current-organization";
  const baselineVersion = value.data
    ? `${baselineScope}:${value.data.baselineUpdatedAt ?? (value.data.configured ? value.data.generatedAt : "unconfigured")}`
    : "";
  useEffect(() => {
    const scopeChanged = baselineScope !== hydratedBaselineScope;
    if (!value.data || !baselineVersion || baselineVersion === hydratedBaselineVersion || (baselineDirty && !scopeChanged)) return;
    const hydratedForm = customerValueDashboardToForm(value.data);
    setBaselineForm(hydratedForm);
    setSavedBaselineForm(hydratedForm);
    setBaselineConfigured(value.data.configured);
    setHydratedBaselineScope(baselineScope);
    setHydratedBaselineVersion(baselineVersion);
  }, [baselineDirty, baselineScope, baselineVersion, hydratedBaselineScope, hydratedBaselineVersion, value.data]);

  const setBaselineField = (field: keyof CustomerValueBaselineForm, fieldValue: string) => {
    setBaselineForm((current) => ({ ...current, [field]: fieldValue }));
  };

  if (workspace.isLoading || facilities.isLoading) return <QueryLoading what="CareBase Value Center" />;
  const primaryFailure = [workspace, facilities].find((query) => query.isError);
  if (primaryFailure?.error) return <QueryError what="CareBase Value Center" error={primaryFailure.error} onRetry={() => void Promise.all([workspace.refetch(), facilities.refetch()])} />;

  const openWarRooms = data?.warRooms.filter((room) => !["closed", "canceled"].includes(String(room.status))) ?? [];
  const currentProject = data?.implementationProjects.find((project) => project.status !== "live") ?? data?.implementationProjects[0];
  const pendingDrafts = data?.copilotDrafts.filter((draft) => draft.status === "draft") ?? [];
  const baselineValid = isCustomerValueBaselineValid(baselineForm);
  const baselineReady = value.isSuccess && savedBaselineForm !== null;
  const isRefreshing = [workspace, facilities, value, staffing, admissions].some((query) => query.isFetching);
  const quickLinks: Array<{ title: string; description: string; href: string; icon: LucideIcon }> = [
    { title: "Daily work", description: "Role-based priorities, exceptions, shifts, and work items in one queue.", href: "/app/today", icon: Activity },
    { title: "Inspection readiness", description: "Convert readiness work into an documentation-backed response room.", href: "/app/inspection-readiness", icon: ClipboardCheck },
    { title: "Governed assistant", description: "Ground responses in citations and send proposed work through approval.", href: "/app/regulatory-copilot", icon: Bot },
  ];

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold tracking-tight">CareBase Value Center</h1><p className="max-w-3xl text-muted-foreground">Run the workflows that replace spreadsheets, paper binders, reminder calendars, point solutions, and disconnected follow-up—then measure the time and software cost returned to the facility.</p></div>
      <div className="flex gap-2"><Select value={facilityId} onValueChange={setSelectedFacilityId}><SelectTrigger className="w-56"><SelectValue placeholder="Select facility" /></SelectTrigger><SelectContent>{facilities.data?.map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={isRefreshing} onClick={() => void Promise.all([workspace.refetch(), facilities.refetch(), value.refetch(), staffing.refetch(), admissions.refetch()])}><RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />Refresh</Button></div>
    </div>

    <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>One governed operating system</AlertTitle><AlertDescription>Automation creates traceable work, the inspection room links requests to documentation, assistant actions require human approval, and every workflow remains tenant- and facility-scoped.</AlertDescription></Alert>

    <Tabs defaultValue="overview" className="space-y-5">
      <TabsList className="flex h-auto flex-wrap justify-start">
        <TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="automation">Automation</TabsTrigger>
        <TabsTrigger value="inspection">Inspection room</TabsTrigger><TabsTrigger value="implementation">Implementation</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger><TabsTrigger value="reports">Savings & reports</TabsTrigger>
        <TabsTrigger value="workforce">Staffing</TabsTrigger><TabsTrigger value="operations">Admissions & operations</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-5">
        {value.isLoading ? <QueryLoading what="customer value metrics" /> : value.isError ? <QueryError what="customer value metrics" error={value.error} onRetry={() => value.refetch()} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Estimated annual savings" value={money(((value.data?.estimatedLaborValue ?? 0) + (value.data?.retiredSoftwareMonthlyCost ?? 0)) * 12)} detail="Customer assumptions multiplied by recorded outcomes" icon={CircleDollarSign} />
          <Metric label="Active automations" value={data?.automations.filter((rule) => rule.state === "active").length ?? 0} detail={`${number(data?.automationRuns.length)} recent execution receipts`} icon={Sparkles} />
          <Metric label="Open inspection rooms" value={openWarRooms.length} detail="Live documentation response workspaces" icon={Radar} />
          <Metric label="Open operating exceptions" value={(data?.portalRequests.length ?? 0) + (data?.medicationExceptions.length ?? 0) + (data?.integration.deliveryFailures ?? 0)} detail="Portal, medication, and integration follow-up" icon={AlertTriangle} />
        </div>}
        <div className="grid gap-4 lg:grid-cols-3">{quickLinks.map(({ title, description, href, icon: Icon }) => <Card key={title}><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5" />{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link href={href}>Open workflow</Link></Button></CardContent></Card>)}</div>
      </TabsContent>

      <TabsContent value="automation" className="space-y-5">
        <Card><CardHeader><CardTitle>Compliance automation builder</CardTitle><CardDescription>Turn a governed event into a deduplicated follow-up item and an in-app manager notification. Conditions and actions are allowlisted server-side.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-4"><div className="space-y-2 md:col-span-2"><Label>Rule name</Label><Input value={automationName} onChange={(event) => setAutomationName(event.target.value)} /></div><div className="space-y-2"><Label>Trigger</Label><Select value={automationTrigger} onValueChange={setAutomationTrigger}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["alert_created","incident_reported","medication_exception","admission_stage","manual"].map((item) => <SelectItem key={item} value={item}>{human(item)}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Priority</Label><Select value={automationPriority} onValueChange={(item) => setAutomationPriority(item as typeof automationPriority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["normal","high","urgent"].map((item) => <SelectItem key={item} value={item}>{human(item)}</SelectItem>)}</SelectContent></Select></div><div className="md:col-span-4"><Button disabled={!facilityId || automationName.trim().length < 3 || saveAutomation.isPending} onClick={() => void notify(() => saveAutomation.mutateAsync({ facilityId, name: automationName.trim(), description: "CareBase-created follow-up with traceable work and manager notification.", triggerType: automationTrigger, actions: [{ type: "create_work_item", title: automationName.trim(), priority: automationPriority, dueDays: automationPriority === "urgent" ? 1 : 7 }, { type: "notify_roles", title: automationName.trim(), roles: ["org_admin", "facility_manager"], link: "/app/today" }], state: "active" }), "Automation activated")}><Sparkles className="mr-2 h-4 w-4" />Activate automation</Button></div></CardContent></Card>
        <div className="space-y-3">{data?.automations.length ? data.automations.map((rule) => <Card key={rule.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><p className="font-medium">{rule.name}</p><Badge variant={rule.state === "active" ? "default" : "secondary"}>{human(rule.state)}</Badge></div><p className="text-sm text-muted-foreground">{human(rule.trigger_type)} · {number(rule.run_count)} executions</p></div><Button size="sm" variant="outline" disabled={!facilityId || runAutomation.isPending} onClick={() => void notify(() => runAutomation.mutateAsync({ ruleId: rule.id, facilityId }), "Automation executed") }><Play className="mr-2 h-4 w-4" />Run now</Button></CardContent></Card>) : <Empty>No automation rules yet. Activate the first rule above.</Empty>}</div>
      </TabsContent>

      <TabsContent value="inspection" className="space-y-5">
        <Card><CardHeader><CardTitle>Start an inspection War Room</CardTitle><CardDescription>Coordinate a survey, complaint response, or mock inspection with numbered documentation requests and linked operational work.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-end gap-3"><div className="min-w-72 flex-1 space-y-2"><Label>Room name</Label><Input value={warRoomName} onChange={(event) => setWarRoomName(event.target.value)} /></div><Button disabled={!facilityId || warRoomName.trim().length < 3 || createWarRoom.isPending} onClick={() => void notify(() => createWarRoom.mutateAsync({ facilityId, name: warRoomName.trim(), inspectionType: "routine", notes: "Created from CareBase Value Center" }), "Inspection room opened")}><Plus className="mr-2 h-4 w-4" />Open room</Button></CardContent></Card>
        {openWarRooms.length ? openWarRooms.map((room) => <Card key={room.id}><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle>{room.name}</CardTitle><CardDescription>{human(room.inspection_type)} · {human(room.status)}</CardDescription></div><Button variant="outline" size="sm" disabled={addWarRoomRequest.isPending} onClick={() => void notify(() => addWarRoomRequest.mutateAsync({ warRoomId: room.id, title: `Documentation request ${(room.requests?.length ?? 0) + 1}`, description: "Collect, verify, and attach the requested inspection documentation.", priority: "high", dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() }), "Documentation request added")}><Plus className="mr-2 h-4 w-4" />Add request</Button></div></CardHeader><CardContent className="space-y-2">{room.requests?.length ? room.requests.map((request: Record<string, any>) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"><div><p className="font-medium">#{request.request_number} {request.title}</p><p className="text-xs text-muted-foreground">{human(request.status)} · due {request.due_at ? new Date(request.due_at).toLocaleString() : "not set"}</p></div>{request.status !== "closed" && <Button size="sm" variant="outline" disabled={updateWarRoomRequest.isPending} onClick={() => void notify(() => updateWarRoomRequest.mutateAsync({ requestId: request.id, status: "closed", responseNote: "Documentation verified by inspection lead." }), "Request verified and closed")}><CheckCircle2 className="mr-2 h-4 w-4" />Verify</Button>}</div>) : <Empty>No requests yet. Add the first documentation request.</Empty>}</CardContent></Card>) : <Empty>No active inspection rooms.</Empty>}
      </TabsContent>

      <TabsContent value="implementation" className="space-y-5">
        <Card><CardHeader><CardTitle>Implementation and migration center</CardTitle><CardDescription>Track discovery, roster import, configuration, validation, training, and go-live as one accountable project.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-end gap-3"><div className="min-w-72 flex-1 space-y-2"><Label>Project name</Label><Input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></div><Button disabled={projectName.trim().length < 3 || initializeProject.isPending} onClick={() => void notify(() => initializeProject.mutateAsync({ name: projectName.trim(), targetGoLiveOn: through, sourceSystems: ["spreadsheets", "paper_binders", "legacy_point_solutions"] }), "Implementation project initialized")}><FolderKanban className="mr-2 h-4 w-4" />Start implementation</Button></CardContent></Card>
        {currentProject ? <Card><CardHeader><CardTitle>{currentProject.name}</CardTitle><CardDescription>{human(currentProject.status)} · target {currentProject.target_go_live_date ? new Date(currentProject.target_go_live_date).toLocaleDateString() : "not set"}</CardDescription></CardHeader><CardContent className="space-y-2">{currentProject.tasks?.map((task: Record<string, any>) => <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><p className="font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{human(task.category)} · {human(task.status)}</p></div>{task.status !== "complete" && <Button size="sm" variant="outline" disabled={updateImplementationTask.isPending} onClick={() => void notify(() => updateImplementationTask.mutateAsync({ taskId: task.id, status: "complete", note: "Completed in implementation center" }), "Implementation task completed")}>Mark complete</Button>}</div>)}</CardContent></Card> : <Empty>No implementation project has been started.</Empty>}
      </TabsContent>

      <TabsContent value="integrations" className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3"><Metric label="API credentials" value={data?.integration.credentials.length ?? 0} icon={Cable} /><Metric label="Webhook endpoints" value={data?.integration.endpoints.length ?? 0} icon={Activity} /><Metric label="Failed deliveries" value={data?.integration.deliveryFailures ?? 0} icon={AlertTriangle} /></div>
        <Alert><Cable className="h-4 w-4" /><AlertTitle>Signed, scoped, and replayable</AlertTitle><AlertDescription>The Integration Hub uses one-time API secrets, explicit scopes, signed webhook delivery, retry documentation, and dead-letter replay. Configure it in Enterprise Foundation; medication sources bind to those same governed credentials.</AlertDescription></Alert>
        <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Credentials</CardTitle></CardHeader><CardContent className="space-y-2">{data?.integration.credentials.length ? data.integration.credentials.map((item) => <div key={item.id} className="rounded border p-3"><div className="flex justify-between gap-2"><p className="font-medium">{item.name}</p><Badge variant="outline">{human(item.status)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{(item.scopes ?? []).join(", ")}</p></div>) : <Empty>No API credentials issued.</Empty>}</CardContent></Card><Card><CardHeader><CardTitle>Webhook health</CardTitle></CardHeader><CardContent className="space-y-2">{data?.integration.endpoints.length ? data.integration.endpoints.map((item) => <div key={item.id} className="rounded border p-3"><div className="flex justify-between gap-2"><p className="font-medium">{item.name}</p><Badge variant={Number(item.consecutiveFailures) > 0 ? "destructive" : "outline"}>{human(item.status)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{number(item.consecutiveFailures)} consecutive failures</p></div>) : <Empty>No webhook endpoints configured.</Empty>}</CardContent></Card></div>
        <Button asChild><Link href="/app/enterprise"><Cable className="mr-2 h-4 w-4" />Configure Integration Hub</Link></Button>
      </TabsContent>

      <TabsContent value="reports" className="space-y-5">
        {value.isLoading ? <QueryLoading what="value and savings metrics" /> : value.isError ? <QueryError what="value and savings metrics" error={value.error} onRetry={() => value.refetch()} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric label="Hours returned / 30 days" value={number(value.data?.estimatedHoursSaved)} icon={CalendarClock} /><Metric label="Annual labor value" value={money((value.data?.estimatedLaborValue ?? 0) * 12)} icon={CircleDollarSign} /><Metric label="Retired software / year" value={money((value.data?.retiredSoftwareMonthlyCost ?? 0) * 12)} icon={CloudOff} /><Metric label="Recorded outcomes" value={number(value.data ? Object.values(value.data.activity).reduce((sum, item) => sum + Number(item), 0) : 0)} icon={BarChart3} /></div>}
        <div className="grid gap-5 xl:grid-cols-2"><Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Value baseline</CardTitle>{!baselineConfigured ? <Badge variant="secondary">Suggested starting values</Badge> : baselineDirty ? <Badge variant="secondary">Unsaved changes</Badge> : <Badge variant="outline">Saved baseline</Badge>}</div><CardDescription>{baselineConfigured ? "Your saved organization baseline is loaded below. Refreshes will not replace unsaved edits." : "Review these suggested starting values before saving the organization's first baseline."} Each time estimate is multiplied only by its matching recorded outcome.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Hourly admin cost</Label><Input type="number" min="0" step="0.01" disabled={!baselineReady} value={baselineForm.hourlyCost} onChange={(event) => setBaselineField("hourlyCost", event.target.value)} /></div><div className="space-y-2"><Label>Annual retired-software cost</Label><Input type="number" min="0" step="0.01" disabled={!baselineReady} value={baselineForm.softwareCost} onChange={(event) => setBaselineField("softwareCost", event.target.value)} /></div><div className="space-y-2"><Label>Minutes saved per report export</Label><Input type="number" min="0" step="0.01" disabled={!baselineReady} value={baselineForm.reportMinutes} onChange={(event) => setBaselineField("reportMinutes", event.target.value)} /></div><div className="space-y-2"><Label>Minutes saved per mock inspection</Label><Input type="number" min="0" step="0.01" disabled={!baselineReady} value={baselineForm.inspectionMinutes} onChange={(event) => setBaselineField("inspectionMinutes", event.target.value)} /></div><div className="space-y-2"><Label>Admin minutes saved per course completion</Label><Input type="number" min="0" step="0.01" disabled={!baselineReady} value={baselineForm.courseMinutes} onChange={(event) => setBaselineField("courseMinutes", event.target.value)} /></div><div className="space-y-2"><Label>Minutes saved per closed work item</Label><Input type="number" min="0" step="0.01" disabled={!baselineReady} value={baselineForm.workItemMinutes} onChange={(event) => setBaselineField("workItemMinutes", event.target.value)} /></div><div className="space-y-2"><Label>Minutes saved per portal message</Label><Input type="number" min="0" step="0.01" disabled={!baselineReady} value={baselineForm.portalMinutes} onChange={(event) => setBaselineField("portalMinutes", event.target.value)} /></div><div className="space-y-2"><Label>Systems replaced (comma separated)</Label><Input disabled={!baselineReady} value={baselineForm.replacedSystems} onChange={(event) => setBaselineField("replacedSystems", event.target.value)} /></div><div className="flex flex-wrap gap-2 sm:col-span-2"><AlertDialog><AlertDialogTrigger asChild><Button disabled={!baselineReady || !baselineValid || !baselineDirty || saveBaseline.isPending}><Save className="mr-2 h-4 w-4" />Save baseline</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{baselineConfigured ? "Replace the saved value baseline?" : "Save this value baseline?"}</AlertDialogTitle><AlertDialogDescription>{baselineConfigured ? "This replaces the organization's current cost and time-saving assumptions. Future value estimates will use the new values." : "Future value estimates will use these organization-specific cost and time-saving assumptions."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={saveBaseline.isPending} onClick={() => { const submitted = { ...baselineForm }; void notify(async () => { await saveBaseline.mutateAsync(customerValueBaselineToInput(submitted)); setSavedBaselineForm(submitted); setBaselineConfigured(true); }, "Value baseline saved"); }}>{baselineConfigured ? "Replace baseline" : "Save baseline"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><Button variant="outline" disabled={!baselineConfigured || !baselineDirty || saveBaseline.isPending || !savedBaselineForm} onClick={() => savedBaselineForm && setBaselineForm({ ...savedBaselineForm })}><RotateCcw className="mr-2 h-4 w-4" />Reset to saved</Button></div>{!baselineValid && <p className="text-sm text-destructive sm:col-span-2">Use the supported non-negative cost and time ranges and no more than 20 system names (120 characters each).</p>}</CardContent></Card>
        </div>
        <ReportScheduleManager />
      </TabsContent>

      <TabsContent value="workforce" className="space-y-5">
        {!facilityId ? <Empty>Select a facility to calculate qualification-aware staffing recommendations.</Empty> : staffing.isLoading ? <QueryLoading what="staffing recommendations" /> : staffing.isError ? <QueryError what="staffing recommendations" error={staffing.error} onRetry={() => staffing.refetch()} /> : <><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric label="Open shifts" value={staffing.data?.openShifts ?? 0} icon={Users} /><Metric label="Pending time off" value={staffing.data?.pendingTimeOff ?? 0} icon={CalendarClock} /><Metric label="Pending swaps" value={staffing.data?.pendingSwaps ?? 0} icon={RefreshCw} /><Metric label="Blocked assignments" value={staffing.data?.recentBlockedAssignments ?? 0} detail="Last 30 days" icon={ShieldCheck} /></div>
        <Card><CardHeader><CardTitle>Qualification-aware coverage recommendations</CardTitle><CardDescription>Coverage uses the active schedule, service workload, availability, time off, swaps, and immutable eligibility decisions.</CardDescription></CardHeader><CardContent className="space-y-3">{staffing.data?.recommendations.length ? staffing.data.recommendations.map((item) => <Button key={item.title} asChild variant="outline" className="h-auto w-full justify-between py-3"><Link href={item.href}><span>{item.title}</span><Badge variant={item.priority === "high" ? "destructive" : "secondary"}>{human(item.priority)}</Badge></Link></Button>) : <div className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />No immediate staffing exception identified for the next 30 days.</div>}</CardContent></Card></>}
      </TabsContent>

      <TabsContent value="operations" className="space-y-5">
        {admissions.isLoading ? <QueryLoading what="admissions and occupancy intelligence" /> : admissions.isError ? <QueryError what="admissions and occupancy intelligence" error={admissions.error} onRetry={() => admissions.refetch()} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric label="Active prospects" value={admissions.data?.pipeline.active ?? 0} icon={Users} /><Metric label="Expected move-ins" value={admissions.data?.pipeline.expected30Days ?? 0} detail="Next 30 days" icon={BedDouble} /><Metric label="Available beds" value={admissions.data?.occupancy.availableBeds ?? 0} icon={BedDouble} /><Metric label="Portal requests" value={data?.portalRequests.length ?? 0} icon={ClipboardCheck} /></div>}
        <div className="grid gap-5 xl:grid-cols-2"><Card><CardHeader><CardTitle>Admissions and occupancy intelligence</CardTitle><CardDescription>Connect pipeline conversion, referral sources, move-in readiness, and bed inventory.</CardDescription></CardHeader><CardContent className="space-y-2">{admissions.data?.referralSources.length ? admissions.data.referralSources.map((source) => <div key={source.source} className="grid grid-cols-4 gap-2 rounded border p-3 text-sm"><span className="col-span-2 font-medium">{source.source}</span><span>{source.inquiries} inquiries</span><span>{source.conversion_percent}% converted</span></div>) : <Empty>No referral-source activity yet.</Empty>}<Button asChild variant="outline"><Link href="/app/admissions">Open admissions workspace</Link></Button></CardContent></Card>
        <Card><CardHeader><CardTitle>Operational exceptions</CardTitle><CardDescription>Designated-person requests, medication sync exceptions, offline conflicts, and governed assistant drafts stay visible until resolved.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-2 gap-3"><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Medication exceptions</p><p className="text-2xl font-bold">{data?.medicationExceptions.length ?? 0}</p></div><div className="rounded border p-3"><p className="text-xs text-muted-foreground">Offline conflicts</p><p className="text-2xl font-bold">{data?.offline.syncConflicts ?? 0}</p></div></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/app/medication-integration">Medication queue</Link></Button><Button asChild variant="outline"><Link href="/app/residents">Resident portals</Link></Button><Button asChild variant="outline"><Link href="/me/courses">Offline learning</Link></Button></div></CardContent></Card></div>
        <Card>
          <CardHeader><CardTitle>Governed assistant action drafts</CardTitle><CardDescription>The assistant can propose work, but only a manager can approve execution. Approval creates ordinary, traceable work items.</CardDescription></CardHeader>
          <CardContent className="space-y-3">{pendingDrafts.length ? pendingDrafts.map((draft) => <div key={draft.id} className="flex flex-wrap items-start justify-between gap-3 rounded border p-3"><div><p className="font-medium">{draft.title}</p><p className="text-sm text-muted-foreground">{human(draft.intent)}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={reviewDraft.isPending} onClick={() => void notify(() => reviewDraft.mutateAsync({ draftId: draft.id, decision: "reject", reviewNote: "Rejected in Value Center after human review." }), "Draft rejected")}>Reject</Button><Button size="sm" disabled={reviewDraft.isPending} onClick={() => void notify(() => reviewDraft.mutateAsync({ draftId: draft.id, decision: "approve", reviewNote: "Approved in Value Center after human review." }), "Draft approved and work created")}>Approve & create work</Button></div></div>) : <Empty>No assistant drafts await review.</Empty>}</CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  </div>;
}
