import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Loader2,
  Settings2,
  UserCheck,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import {
  useAssignResidentServiceTask,
  useListResidentServiceRequirements,
  useListServiceExceptionRules,
  useListServiceTaskAlerts,
  useRecordResidentServiceTask,
  useResidentServiceTaskQueue,
  useResolveServiceTaskAlert,
  useServiceTaskAvailableStaff,
  useUpdateResidentServiceRequirement,
  useUpsertServiceExceptionRule,
  type ResidentServiceTaskQueueRow,
  type ServiceRequirementWithRelations,
  type ServiceExceptionRule,
  type ServiceTaskAlertWithRelations,
} from "@/hooks/useResidentServiceTasks";
import { LogChangeOfConditionDialog } from "@/components/residents/LogChangeOfConditionDialog";
import { QueryError } from "@/components/QueryState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const OUTCOMES = [
  ["completed", "Completed"],
  ["resident_refused", "Resident refused"],
  ["resident_unavailable", "Resident unavailable"],
  ["not_completed", "Not completed"],
  ["completed_by_other", "Completed by another authorized employee"],
] as const;

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  resident_refused: "Resident refused",
  resident_unavailable: "Resident unavailable",
  not_completed: "Not completed",
  completed_late: "Completed late",
  completed_by_other: "Completed by another",
  superseded: "Superseded",
};

const STATUS_CLASS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-900",
  completed: "bg-emerald-100 text-emerald-900",
  completed_late: "bg-amber-100 text-amber-900",
  resident_refused: "bg-orange-100 text-orange-900",
  resident_unavailable: "bg-purple-100 text-purple-900",
  not_completed: "bg-red-100 text-red-900",
  completed_by_other: "bg-cyan-100 text-cyan-900",
  superseded: "bg-muted text-muted-foreground",
};

function localDateString(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function dayBounds(dateString: string): { from: string; through: string } {
  const from = new Date(`${dateString}T00:00:00`);
  const through = new Date(from);
  through.setDate(through.getDate() + 1);
  return { from: from.toISOString(), through: through.toISOString() };
}

function formatTaskTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function RequirementDialog({
  requirement,
  onClose,
}: {
  requirement: ServiceRequirementWithRelations | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateResidentServiceRequirement();
  const [frequency, setFrequency] = useState(requirement?.frequency ?? "daily");
  const [frequencyDetail, setFrequencyDetail] = useState(requirement?.frequency_detail ?? "");
  const [start, setStart] = useState(requirement?.time_window_start?.slice(0, 5) ?? "09:00");
  const [end, setEnd] = useState(requirement?.time_window_end?.slice(0, 5) ?? "11:00");
  const [role, setRole] = useState(requirement?.responsible_role ?? "DCS");
  const [instructions, setInstructions] = useState(requirement?.special_instructions ?? "");
  const [twoStaff, setTwoStaff] = useState(requirement?.requires_two_staff ?? false);
  const [documentationMode, setDocumentationMode] = useState(requirement?.documentation_mode ?? "every_task");
  const [expiresOn, setExpiresOn] = useState(requirement?.expires_on ?? "");

  const save = () => {
    if (!requirement) return;
    update.mutate({
      requirementId: requirement.id,
      frequency,
      frequencyDetail,
      timeWindowStart: start,
      timeWindowEnd: end,
      responsibleRole: role,
      unitId: requirement.unit_id,
      specialInstructions: instructions,
      requiresTwoStaff: twoStaff,
      documentationMode,
      expiresOn: expiresOn || null,
    }, {
      onSuccess: () => {
        toast({ title: "Service requirement updated", description: "Future tasks were regenerated without changing history." });
        onClose();
      },
      onError: (error: Error) => toast({ title: "Couldn't update requirement", description: error.message, variant: "destructive" }),
    });
  };

  return (
    <Dialog open={!!requirement} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Configure {requirement?.service_name}</DialogTitle>
          <DialogDescription>
            Changes supersede only future task instances. Completed and exception records remain tied to plan v{requirement?.source_plan_version}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["hourly", "daily", "weekly", "monthly", "other"].map(value => (
                  <SelectItem key={value} value={value} className="capitalize">{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Frequency detail</Label>
            <Input value={frequencyDetail} onChange={event => setFrequencyDetail(event.target.value)} placeholder="Optional schedule detail" />
          </div>
          <div className="space-y-1.5"><Label>Window starts</Label><Input type="time" value={start} onChange={event => setStart(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Window ends</Label><Input type="time" value={end} onChange={event => setEnd(event.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Responsible role</Label>
            <Input value={role} onChange={event => setRole(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Expires</Label>
            <Input type="date" value={expiresOn} onChange={event => setExpiresOn(event.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Special instructions</Label>
            <Textarea value={instructions} onChange={event => setInstructions(event.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={twoStaff} onCheckedChange={value => setTwoStaff(value === true)} />
            Two staff required
          </label>
          <div className="space-y-1.5">
            <Label>Documentation</Label>
            <Select value={documentationMode} onValueChange={setDocumentationMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="every_task">Every task</SelectItem>
                <SelectItem value="exception_only">Exception only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={update.isPending || !instructions.trim() || !role.trim() || end <= start}>
            {update.isPending ? "Saving..." : "Save and regenerate future tasks"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleRow({ rule }: { rule: ServiceExceptionRule }) {
  const { toast } = useToast();
  const update = useUpsertServiceExceptionRule();
  const [threshold, setThreshold] = useState(String(rule.threshold_count));
  const [lookback, setLookback] = useState(String(rule.lookback_days));
  return (
    <div className="grid items-end gap-2 rounded-md border p-3 md:grid-cols-[1fr_110px_110px_170px_auto]">
      <div>
        <p className="font-medium capitalize">{rule.exception_status.replace(/_/g, " ")}</p>
        <p className="text-xs text-muted-foreground">Route to {rule.action_target.replace(/_/g, " ")}</p>
      </div>
      <div className="space-y-1"><Label className="text-xs">Occurrences</Label><Input type="number" min={1} value={threshold} onChange={event => setThreshold(event.target.value)} /></div>
      <div className="space-y-1"><Label className="text-xs">Lookback days</Label><Input type="number" min={1} value={lookback} onChange={event => setLookback(event.target.value)} /></div>
      <Badge variant="outline" className="h-9 justify-center">{rule.is_active ? "Active" : "Disabled"}</Badge>
      <Button
        size="sm"
        variant="outline"
        disabled={update.isPending}
        onClick={() => update.mutate({
          facilityId: rule.facility_id,
          exceptionStatus: rule.exception_status,
          thresholdCount: Number(threshold),
          lookbackDays: Number(lookback),
          actionTarget: rule.action_target,
          isActive: rule.is_active,
        }, {
          onSuccess: () => toast({ title: "Exception rule updated" }),
          onError: (error: Error) => toast({ title: "Couldn't update rule", description: error.message, variant: "destructive" }),
        })}
      >
        Save
      </Button>
    </div>
  );
}

export default function ServiceDelivery() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const { toast } = useToast();
  const isEmployee = user?.role === "employee";
  const isManager = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const isAuditor = user?.role === "auditor";
  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  const [date, setDate] = useState(localDateString());
  const [facilityId, setFacilityId] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedTask, setSelectedTask] = useState<ResidentServiceTaskQueueRow | null>(null);
  const [selectedRequirement, setSelectedRequirement] = useState<ServiceRequirementWithRelations | null>(null);
  const [changeReviewAlert, setChangeReviewAlert] = useState<ServiceTaskAlertWithRelations | null>(null);
  const [outcome, setOutcome] = useState("completed");
  const [note, setNote] = useState("");
  const [supervisorNotified, setSupervisorNotified] = useState(false);
  const [secondEmployeeId, setSecondEmployeeId] = useState("");
  const bounds = dayBounds(date);

  const queue = useResidentServiceTaskQueue({
    ...bounds,
    facilityId: facilityId === "all" ? undefined : facilityId,
    status: status === "all" ? undefined : status,
  });
  const requirements = useListResidentServiceRequirements({
    organizationId,
    facilityId: facilityId === "all" ? undefined : facilityId,
    status: "active",
  });
  const alerts = useListServiceTaskAlerts({
    organizationId,
    facilityId: facilityId === "all" ? undefined : facilityId,
    status: "open",
  });
  const rules = useListServiceExceptionRules(facilityId === "all" ? undefined : facilityId);
  const { data: facilities } = useListFacilities({ organizationId });
  const { data: employees } = useListEmployees({
    organizationId,
    status: "active",
  }, { enabled: isManager });
  const { data: availableStaff } = useServiceTaskAvailableStaff(selectedTask?.id);
  const recordTask = useRecordResidentServiceTask();
  const assignTask = useAssignResidentServiceTask();
  const resolveAlert = useResolveServiceTaskAlert();

  const filteredTasks = useMemo(() => (queue.data ?? []).filter(task => {
    if (!search.trim()) return true;
    const needle = search.toLowerCase();
    return `${task.resident_name} ${task.resident_room ?? ""} ${task.service_name}`.toLowerCase().includes(needle);
  }), [queue.data, search]);
  const scheduled = filteredTasks.filter(task => task.status === "scheduled").length;
  const completed = filteredTasks.filter(task => ["completed", "completed_late", "completed_by_other"].includes(task.status)).length;
  const exceptions = filteredTasks.filter(task => ["resident_refused", "resident_unavailable", "not_completed"].includes(task.status)).length;

  const closeOutcome = () => {
    setSelectedTask(null);
    setOutcome("completed");
    setNote("");
    setSupervisorNotified(false);
    setSecondEmployeeId("");
  };

  const submitOutcome = () => {
    if (!selectedTask) return;
    recordTask.mutate({
      taskId: selectedTask.id,
      status: outcome,
      note,
      supervisorNotified,
      secondEmployeeId: secondEmployeeId || null,
    }, {
      onSuccess: () => {
        toast({ title: "Service outcome recorded", description: "The original support-plan version remains attached to this record." });
        closeOutcome();
      },
      onError: (error: Error) => toast({ title: "Couldn't record service", description: error.message, variant: "destructive" }),
    });
  };

  const taskRows = (
    <Card>
      <CardContent className="pt-6">
        {queue.isError ? (
          <QueryError what="resident service tasks" error={queue.error} onRetry={() => queue.refetch()} />
        ) : queue.isLoading ? (
          <div className="space-y-2">{[...Array(5)].map((_, index) => <div key={index} className="h-20 animate-pulse rounded bg-muted" />)}</div>
        ) : filteredTasks.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
            <p className="font-medium">No service tasks match this view</p>
            <p className="text-sm text-muted-foreground">Choose another day or filter.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTasks.map(task => (
              <div key={task.id} className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[120px_1fr_180px_auto] lg:items-center">
                <div>
                  <p className="font-medium">{formatTaskTime(task.scheduled_start)}</p>
                  <p className="text-xs text-muted-foreground">to {formatTaskTime(task.scheduled_end)}</p>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{task.resident_name}</p>
                    {task.resident_room && <Badge variant="outline">Room {task.resident_room}</Badge>}
                    <Badge variant="outline">Plan v{task.source_plan_version}</Badge>
                    {task.requires_two_staff && <Badge variant="secondary"><Users className="mr-1 h-3 w-3" />Two staff</Badge>}
                    {task.documentation_mode === "exception_only" && <Badge variant="secondary">Exception-only note</Badge>}
                  </div>
                  <p className="mt-1 font-medium text-primary">{task.service_name}</p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{task.special_instructions}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {task.responsible_role}{task.unit_name ? ` · ${task.unit_name}` : ""} · {task.facility_name}
                  </p>
                </div>
                <div>
                  <Badge variant="outline" className={`border-0 ${STATUS_CLASS[task.status] ?? ""}`}>
                    {STATUS_LABELS[task.status] ?? task.status}
                  </Badge>
                  <p className="mt-1 text-xs text-muted-foreground">{task.assigned_employee_name ?? "Unassigned team task"}</p>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {isManager && task.status === "scheduled" && (
                    <Select
                      value={task.assigned_employee_id ?? "unassigned"}
                      onValueChange={employeeId => {
                        if (employeeId === "unassigned") return;
                        assignTask.mutate({ taskId: task.id, employeeId }, {
                          onSuccess: () => toast({ title: "Service task assigned" }),
                          onError: (error: Error) => toast({ title: "Couldn't assign task", description: error.message, variant: "destructive" }),
                        });
                      }}
                    >
                      <SelectTrigger className="w-44"><SelectValue placeholder="Assign staff" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Assign staff</SelectItem>
                        {(employees ?? []).filter(employee => employee.facility_id === task.facility_id).map(employee => (
                          <SelectItem key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {!isAuditor && task.status === "scheduled" && (
                    <Button onClick={() => setSelectedTask(task)}>
                      <CalendarCheck className="mr-2 h-4 w-4" /> Record
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <CalendarCheck className="h-6 w-6" />
          {isEmployee ? "My Services" : "Resident Service Delivery"}
        </h1>
        <p className="text-muted-foreground">
          {isEmployee
            ? "Record required residential services and exceptions for your facility."
            : "Support-plan requirements, scheduled service tasks, and exception follow-up. This is the operational service layer; clinical orders and medications live in the resident clinical chart (FHIR-integrated)."}
        </p>
      </div>

      <Alert>
        <ClipboardList className="h-4 w-4" />
        <AlertTitle>Version-controlled residential services</AlertTitle>
        <AlertDescription>
          Every task stays tied to the finalized RASP/ASP version active when it was scheduled. Plan revisions supersede future work without rewriting prior service records.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 pt-6"><Clock3 className="h-8 w-8 text-blue-600" /><div><p className="text-2xl font-bold">{queue.isLoading ? "—" : scheduled}</p><p className="text-sm text-muted-foreground">Scheduled</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-6"><CheckCircle2 className="h-8 w-8 text-emerald-600" /><div><p className="text-2xl font-bold">{queue.isLoading ? "—" : completed}</p><p className="text-sm text-muted-foreground">Completed</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-6"><AlertTriangle className="h-8 w-8 text-amber-600" /><div><p className="text-2xl font-bold">{queue.isLoading ? "—" : exceptions}</p><p className="text-sm text-muted-foreground">Exceptions</p></div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="grid gap-2 pt-6 sm:grid-cols-2 xl:grid-cols-4">
          <Input type="date" value={date} onChange={event => setDate(event.target.value)} aria-label="Service date" />
          {!isEmployee && (
            <Select value={facilityId} onValueChange={setFacilityId}>
              <SelectTrigger><SelectValue placeholder="All facilities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All facilities</SelectItem>
                {facilities?.map(facility => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search resident, room, or service" />
        </CardContent>
      </Card>

      {isEmployee ? taskRows : (
        <Tabs defaultValue="tasks">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="tasks">Service tasks</TabsTrigger>
            <TabsTrigger value="requirements">Requirements ({requirements.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="alerts">Exception alerts ({alerts.data?.length ?? 0})</TabsTrigger>
          </TabsList>
          <TabsContent value="tasks" className="mt-4">{taskRows}</TabsContent>
          <TabsContent value="requirements" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Active service requirements</CardTitle>
                <CardDescription>Materialized automatically from finalized support plans. Configuration changes regenerate future tasks only.</CardDescription>
              </CardHeader>
              <CardContent>
                {requirements.isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : requirements.isError ? (
                  <QueryError what="service requirements" error={requirements.error} onRetry={() => requirements.refetch()} />
                ) : !requirements.data?.length ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No finalized support-plan requirements found.</p>
                ) : (
                  <div className="space-y-3">
                    {requirements.data.map(requirement => (
                      <div key={requirement.id} className="grid gap-3 rounded-md border p-4 lg:grid-cols-[1fr_180px_180px_auto] lg:items-center">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">{requirement.resident ? `${requirement.resident.first_name} ${requirement.resident.last_name}` : "Resident"}</p>
                            <Badge variant="outline">{requirement.service_name}</Badge>
                            <Badge variant="outline">Plan v{requirement.source_plan_version}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{requirement.special_instructions}</p>
                        </div>
                        <p className="text-sm capitalize">{requirement.frequency}{requirement.frequency_detail ? ` · ${requirement.frequency_detail}` : ""}<br /><span className="text-muted-foreground">{requirement.time_window_start.slice(0, 5)}–{requirement.time_window_end.slice(0, 5)}</span></p>
                        <p className="text-sm">{requirement.responsible_role}<br /><span className="text-muted-foreground">{requirement.requires_two_staff ? "Two staff" : "One staff"} · {requirement.documentation_mode === "exception_only" ? "Exception-only" : "Every task"}</span></p>
                        {isManager && <Button variant="outline" size="sm" onClick={() => setSelectedRequirement(requirement)}><Settings2 className="mr-2 h-4 w-4" />Configure</Button>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="alerts" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5" /> Open service exception alerts</CardTitle>
                <CardDescription>Repeated or serious exceptions route to supervisor, change-of-condition, support-plan review, or QAPI follow-up.</CardDescription>
              </CardHeader>
              <CardContent>
                {alerts.isError ? <QueryError what="service alerts" error={alerts.error} onRetry={() => alerts.refetch()} /> : !alerts.data?.length ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No open service exception alerts.</p>
                ) : (
                  <div className="space-y-3">
                    {alerts.data.map(item => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
                        <div>
                          <div className="flex items-center gap-2"><Badge variant={item.severity === "critical" ? "destructive" : "outline"}>{item.severity}</Badge><p className="font-semibold">{item.title}</p></div>
                          <p className="mt-1 text-sm">{item.resident ? `${item.resident.first_name} ${item.resident.last_name}` : "Resident"} · {item.task?.service_name}</p>
                          <p className="text-sm text-muted-foreground">{item.message}</p>
                        </div>
                        {isManager && <div className="flex gap-2">{item.alert_type === "change_of_condition_review" && <Button size="sm" onClick={() => setChangeReviewAlert(item)}>Start change review</Button>}<Button size="sm" variant="outline" onClick={() => resolveAlert.mutate({ alertId: item.id, status: "acknowledged" })}>Acknowledge</Button><Button size="sm" variant="outline" onClick={() => resolveAlert.mutate({ alertId: item.id, status: "resolved" })}>Resolve</Button></div>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            {isManager && (
              <Card>
                <CardHeader><CardTitle>Exception routing rules</CardTitle><CardDescription>Select one facility to configure thresholds and lookback periods.</CardDescription></CardHeader>
                <CardContent>
                  {facilityId === "all" ? <p className="text-sm text-muted-foreground">Select a facility to edit its rules.</p> : (
                    <div className="space-y-2">{rules.data?.map(rule => <RuleRow key={rule.id} rule={rule} />)}</div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={!!selectedTask} onOpenChange={open => !open && closeOutcome()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record {selectedTask?.service_name}</DialogTitle>
            <DialogDescription>
              {selectedTask?.resident_name} · {selectedTask && formatTaskTime(selectedTask.scheduled_start)} · Plan v{selectedTask?.source_plan_version}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Outcome</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{OUTCOMES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Additional note {outcome !== "completed" ? "*" : ""}</Label>
              <Textarea value={note} onChange={event => setNote(event.target.value)} placeholder={selectedTask?.documentation_mode === "exception_only" ? "Required only when documenting an exception" : "Optional service note"} />
            </div>
            {selectedTask?.requires_two_staff && (
              <div className="space-y-1.5">
                <Label>Second authorized employee *</Label>
                <Select value={secondEmployeeId} onValueChange={setSecondEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="Select second staff member" /></SelectTrigger>
                  <SelectContent>{availableStaff?.map(employee => <SelectItem key={employee.employee_id} value={employee.employee_id}>{employee.employee_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={supervisorNotified} onCheckedChange={value => setSupervisorNotified(value === true)} /><UserCheck className="h-4 w-4" />Supervisor notified</label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeOutcome}>Cancel</Button>
            <Button disabled={recordTask.isPending || (outcome !== "completed" && note.trim().length < 3) || (!!selectedTask?.requires_two_staff && !secondEmployeeId)} onClick={submitOutcome}>
              {recordTask.isPending ? "Recording..." : "Record outcome"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RequirementDialog requirement={selectedRequirement} onClose={() => setSelectedRequirement(null)} />
      <LogChangeOfConditionDialog
        open={!!changeReviewAlert}
        onOpenChange={open => !open && setChangeReviewAlert(null)}
        residentId={changeReviewAlert?.resident_id}
        sourceServiceAlertId={changeReviewAlert?.id}
      />
    </div>
  );
}
