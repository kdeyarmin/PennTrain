import { useEffect, useId, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useListEmployeesByIds, type Employee } from "@/hooks/useEmployees";
import { EmployeeSearchSelect } from "@/components/employees/EmployeeSearchSelect";
import { useListFacilities } from "@/hooks/useFacilities";
import {
  useApplyEmployeeLifecycleCase,
  useCancelEmployeeLifecycleCase,
  useCreateEmployeeLifecycleCase,
  useEmployeeLifecycleCases,
  useRefreshEmployeeLifecycleCase,
  type EmployeeLifecycleCase,
} from "@/hooks/useEmployeeLifecycleCases";
import {
  EMPLOYEE_LIFECYCLE_CASE_STATUSES,
  EMPLOYEE_LIFECYCLE_TRANSITIONS,
  canApplyLifecycleCase,
  canCancelLifecycleCase,
  canRefreshLifecycleCase,
  lifecycleCaseStatusLabel,
  lifecycleCasesToCsv,
  lifecyclePreviewReasons,
  lifecycleTransitionAdmitsStatus,
  lifecycleTransitionEligibleStatuses,
  lifecycleTransitionLabel,
  summarizeLifecyclePreview,
  transitionRequiresTargetFacility,
  type EmployeeLifecycleTransition,
} from "@/lib/employeeLifecycleCases";
import { facilityToday } from "@/lib/dateUtils";
import { downloadCsv } from "@/lib/dataImportCenter";

const PAGE_SIZE = 25;

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "applied") return "default";
  if (status === "blocked" || status === "canceled") return "destructive";
  if (status === "ready") return "secondary";
  return "outline";
}

export default function EmployeeLifecycleCases() {
  const __fieldIds = useId();
  const { user } = useAuth();
  const { toast } = useToast();
  const locationSearch = useSearch();
  const [, navigate] = useLocation();
  const [status, setStatus] = useState("all");
  const [transitionFilter, setTransitionFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<EmployeeLifecycleCase | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [lockedPreviewKey, setLockedPreviewKey] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState("");
  // Kept so the wizard can tell whether a change of transition has left the chosen person
  // ineligible (rehire wants terminated, return wants on_leave) instead of sending a request the
  // server will refuse.
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [transition, setTransition] = useState<EmployeeLifecycleTransition>("leave");
  const [effectiveOn, setEffectiveOn] = useState(() => facilityToday());
  const [targetFacilityId, setTargetFacilityId] = useState("");
  const [reason, setReason] = useState("");

  const filters = useMemo(
    () => ({ status, transition: transitionFilter, page, pageSize: PAGE_SIZE }),
    [status, transitionFilter, page],
  );
  const cases = useEmployeeLifecycleCases(filters);
  // The picker is scoped to the statuses the SELECTED transition admits, not to "active".
  // `preview_employee_lifecycle_transition` requires `terminated` for rehire and `on_leave` for
  // return, so an active-only roster made both unreachable from any screen -- the transition
  // dropdown listed them and no pickable person could ever satisfy them. It is a search-and-page
  // picker rather than a single unpaginated read so widening the status set cannot reintroduce the
  // PostgREST 1000-row cap that scoping to active was working around.
  const eligibleStatuses = lifecycleTransitionEligibleStatuses(transition);

  // Labels for the cases actually on screen, fetched by id. A termination case is by definition a
  // case whose employee is no longer active, so the active list cannot name them -- and this page
  // shows one page of cases at a time, so the set is small and bounded by what is rendered.
  // `useListEmployeesByIds` exists for exactly this ("keeps the payload proportional to the work
  // on screen instead of the whole tenant roster").
  const caseEmployeeIds = useMemo(
    () => [...new Set((cases.data?.rows ?? []).map((row) => row.employee_id).filter(Boolean))],
    [cases.data?.rows],
  );
  const caseEmployees = useListEmployeesByIds(caseEmployeeIds);
  const employeeNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const employee of caseEmployees.data ?? []) {
      byId.set(employee.id, `${employee.first_name} ${employee.last_name}`);
    }
    return byId;
  }, [caseEmployees.data]);
  const facilities = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const createCase = useCreateEmployeeLifecycleCase();
  const refreshCase = useRefreshEmployeeLifecycleCase();
  const applyCase = useApplyEmployeeLifecycleCase();
  const cancelCase = useCancelEmployeeLifecycleCase();

  const total = cases.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const employeeName = (id: string) => employeeNameById.get(id) ?? id.slice(0, 8);

  const wizardKey = JSON.stringify({
    employeeId,
    transition,
    effectiveOn,
    targetFacilityId: transitionRequiresTargetFacility(transition) ? targetFacilityId : null,
    reason: reason.trim(),
  });

  const openWizard = (prefill?: { employeeId?: string; transition?: EmployeeLifecycleTransition }) => {
    setWizardOpen(true);
    setEmployeeId(prefill?.employeeId ?? "");
    setSelectedEmployee(null);
    setTransition(prefill?.transition ?? "leave");
    setEffectiveOn(facilityToday());
    setTargetFacilityId("");
    setReason("");
    setLockedPreviewKey(null);
  };

  // "Start lifecycle case" on an employee record opens this wizard with that person already
  // chosen. Without it the employee page had no lifecycle entry point at all, and the roster edit
  // dialog's Status field -- the only other way anyone tried to move someone between states -- is
  // refused by a trigger.
  const changeTransition = (next: EmployeeLifecycleTransition) => {
    setTransition(next);
    // A person eligible for one transition is usually ineligible for the next; clear rather than
    // carry a selection the preview would only reject.
    if (selectedEmployee && !lifecycleTransitionAdmitsStatus(next, selectedEmployee.status)) {
      setEmployeeId("");
      setSelectedEmployee(null);
    }
  };

  // EmployeeDetail's "Start lifecycle case" links here with ?employee=<id>. Consumed immediately so
  // the URL stops asserting a dialog that may no longer be open, and so following the same link a
  // second time (which would otherwise set an identical query string, and so not re-run this
  // effect) opens the wizard again rather than looking broken.
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    const prefillEmployeeId = params.get("employee");
    if (!prefillEmployeeId) return;
    const requested = params.get("transition");
    const prefillTransition = EMPLOYEE_LIFECYCLE_TRANSITIONS.find((value) => value === requested);
    openWizard({ employeeId: prefillEmployeeId, transition: prefillTransition });
    params.delete("employee");
    params.delete("transition");
    const query = params.toString();
    navigate(`/app/employee-lifecycle${query ? `?${query}` : ""}`, { replace: true });
    // openWizard is a stable-enough local closure over setState only; re-running on every render
    // is prevented by the guard above, which returns as soon as the parameter is consumed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationSearch]);

  const onCreate = async () => {
    if (!employeeId || reason.trim().length < 3) {
      toast({ title: "Employee and reason are required", variant: "destructive" });
      return;
    }
    if (transitionRequiresTargetFacility(transition) && !targetFacilityId) {
      toast({ title: "Transfer requires a target facility", variant: "destructive" });
      return;
    }
    try {
      const caseId = await createCase.mutateAsync({
        employeeId,
        transition,
        effectiveOn,
        reason: reason.trim(),
        targetFacilityId: transitionRequiresTargetFacility(transition) ? targetFacilityId : null,
      });
      setLockedPreviewKey(null);
      toast({ title: "Lifecycle case created", description: `Case ${caseId.slice(0, 8)} is ready for review.` });
      setWizardOpen(false);
      cases.refetch();
    } catch (error) {
      toast({
        title: "Could not create lifecycle case",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const onRefresh = async (caseRow: EmployeeLifecycleCase) => {
    try {
      await refreshCase.mutateAsync(caseRow.id);
      toast({ title: "Preview refreshed under lock" });
      const refreshed = await cases.refetch();
      const next = refreshed.data?.rows.find((row) => row.id === caseRow.id) ?? null;
      setSelected(next);
      setLockedPreviewKey(caseRow.id);
    } catch (error) {
      toast({
        title: "Refresh blocked",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const onApply = async (caseRow: EmployeeLifecycleCase) => {
    if (lockedPreviewKey !== caseRow.id) {
      toast({
        title: "Re-preview required",
        description: "Refresh the dependency preview for this case before applying.",
        variant: "destructive",
      });
      return;
    }
    try {
      await applyCase.mutateAsync(caseRow.id);
      toast({ title: "Lifecycle transition applied" });
      setSelected(null);
      setLockedPreviewKey(null);
    } catch (error) {
      toast({
        title: "Apply blocked",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const onCancel = async () => {
    if (!selected || cancelReason.trim().length < 3) return;
    try {
      await cancelCase.mutateAsync({ caseId: selected.id, reason: cancelReason.trim() });
      toast({ title: "Lifecycle case canceled" });
      setCancelOpen(false);
      setSelected(null);
      setCancelReason("");
    } catch (error) {
      toast({
        title: "Cancel blocked",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const exportReport = () => {
    const rows = cases.data?.rows ?? [];
    downloadCsv(
      `employee-lifecycle-cases-${facilityToday()}.csv`,
      lifecycleCasesToCsv(rows.map((row) => ({
        id: row.id,
        employee_id: row.employee_id,
        transition: row.transition,
        status: row.status,
        effective_on: row.effective_on,
        reason: row.reason,
        applied_at: row.applied_at,
        canceled_at: row.canceled_at,
      }))),
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Workforce transitions</p>
          <h1 className="text-2xl font-bold tracking-tight">Employee lifecycle cases</h1>
          <p className="max-w-3xl text-muted-foreground">
            Guided transfer, leave, return, termination, rehire, and access cases. Each case records the
            transition's eligibility check -- the employee's current status, employment episode, facility, and
            linked account -- and re-runs it under lock at apply time, so a decision cannot be applied on a
            stale check. It does not enumerate the employee's shifts, courses, or classes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportReport} disabled={!cases.data?.rows.length}>
            <Download className="mr-2 h-4 w-4" /> Export report
          </Button>
          <Button onClick={() => openWizard()}>
            <Plus className="mr-2 h-4 w-4" /> New lifecycle case
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Case queue</CardTitle>
          <CardDescription>Filter by status and transition. Select a case to review dependencies.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(0); }}>
            <SelectTrigger aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {EMPLOYEE_LIFECYCLE_CASE_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>{lifecycleCaseStatusLabel(value)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={transitionFilter} onValueChange={(value) => { setTransitionFilter(value); setPage(0); }}>
            <SelectTrigger aria-label="Transition"><SelectValue placeholder="Transition" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All transitions</SelectItem>
              {EMPLOYEE_LIFECYCLE_TRANSITIONS.map((value) => (
                <SelectItem key={value} value={value}>{lifecycleTransitionLabel(value)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => cases.refetch()} disabled={cases.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${cases.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Cases</CardTitle>
            <CardDescription>{total} case{total === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {cases.isLoading ? (
              <QueryLoading what="lifecycle cases" />
            ) : cases.isError ? (
              <QueryError what="lifecycle cases" error={cases.error} onRetry={() => cases.refetch()} />
            ) : cases.data?.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No lifecycle cases yet. Create a case to capture the dependency preview before applying a transition.
              </p>
            ) : (
              cases.data?.rows.map((caseRow) => (
                <button
                  key={caseRow.id}
                  type="button"
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${
                    selected?.id === caseRow.id ? "border-primary bg-muted/30" : "hover:bg-muted/20"
                  }`}
                  onClick={() => {
                    setSelected(caseRow);
                    setLockedPreviewKey(null);
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{employeeName(caseRow.employee_id)}</p>
                      <p className="text-xs text-muted-foreground">
                        {lifecycleTransitionLabel(caseRow.transition)} · effective {caseRow.effective_on}
                      </p>
                    </div>
                    <Badge variant={statusVariant(caseRow.status)}>
                      {lifecycleCaseStatusLabel(caseRow.status)}
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{caseRow.reason}</p>
                  {/* A blocked case in the queue said only "blocked" -- the reason the server gave
                      is what tells a manager whether to fix something or pick a different
                      transition, so the first one is shown here and all of them in the detail
                      panel. */}
                  {caseRow.status === "blocked" && lifecyclePreviewReasons(caseRow.preview).length > 0 && (
                    <p className="mt-1 line-clamp-2 text-xs text-destructive">
                      {lifecyclePreviewReasons(caseRow.preview)[0]}
                    </p>
                  )}
                </button>
              ))
            )}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t pt-4">
                <p className="text-sm text-muted-foreground">Page {page + 1} of {pageCount}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page + 1 >= pageCount}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Case detail
            </CardTitle>
            <CardDescription>
              The eligibility check is re-run under lock at apply time. Refresh deliberately before applying.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selected ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Select a case to review dependencies.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <p className="font-medium">{employeeName(selected.employee_id)}</p>
                  <p className="text-sm text-muted-foreground">
                    {lifecycleTransitionLabel(selected.transition)} · {lifecycleCaseStatusLabel(selected.status)} · effective {selected.effective_on}
                  </p>
                  <Button asChild size="sm" variant="link" className="h-auto px-0">
                    <Link href={`/app/employees/${selected.employee_id}`}>Open employee record</Link>
                  </Button>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-sm font-medium">Reason</p>
                  <p className="mt-1 text-sm text-muted-foreground">{selected.reason}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Eligibility check</p>
                    {selected.previewed_at && (
                      <p className="text-xs text-muted-foreground">
                        Previewed {new Date(selected.previewed_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {summarizeLifecyclePreview(selected.preview).map((line) => (
                      <li key={line}>• {line}</li>
                    ))}
                  </ul>
                  {lockedPreviewKey === selected.id ? (
                    <p className="mt-3 flex items-center gap-2 text-xs text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Preview locked for apply on this case
                    </p>
                  ) : canApplyLifecycleCase(selected.status) ? (
                    <p className="mt-3 text-xs text-amber-700">
                      Refresh the preview to lock the current dependency decision before applying.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canRefreshLifecycleCase(selected.status) || refreshCase.isPending}
                    onClick={() => void onRefresh(selected)}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Re-preview
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      !canApplyLifecycleCase(selected.status)
                      || lockedPreviewKey !== selected.id
                      || applyCase.isPending
                    }
                    onClick={() => void onApply(selected)}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Apply transition
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!canCancelLifecycleCase(selected.status) || cancelCase.isPending}
                    onClick={() => { setCancelOpen(true); setCancelReason(""); }}
                  >
                    <XCircle className="mr-2 h-4 w-4" /> Cancel case
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New employee lifecycle case</DialogTitle>
            <DialogDescription>
              Capture the transition request and generate the governed dependency preview. Effective date cannot be in the future.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <EmployeeSearchSelect
                required
                value={employeeId}
                onValueChange={setEmployeeId}
                onEmployeeChange={setSelectedEmployee}
                organizationId={user?.organizationId ?? undefined}
                statuses={eligibleStatuses}
                placeholder="Select employee"
                selectedLabel={
                  selectedEmployee ? `${selectedEmployee.last_name}, ${selectedEmployee.first_name}` : undefined
                }
              />
              <p className="text-xs text-muted-foreground">
                Shows the employees {lifecycleTransitionLabel(transition)} accepts
                ({eligibleStatuses.map((value) => value.replaceAll("_", " ")).join(" or ")}).
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-transition`}>Transition</Label>
                <Select value={transition} onValueChange={(value) => changeTransition(value as EmployeeLifecycleTransition)}>
                  <SelectTrigger id={`${__fieldIds}-transition`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYEE_LIFECYCLE_TRANSITIONS.map((value) => (
                      <SelectItem key={value} value={value}>{lifecycleTransitionLabel(value)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lifecycle-effective">Effective date</Label>
                <Input id="lifecycle-effective" type="date" value={effectiveOn} max={facilityToday()} onChange={(event) => setEffectiveOn(event.target.value)} />
              </div>
            </div>
            {transitionRequiresTargetFacility(transition) && (
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-target-facility`}>Target facility</Label>
                <Select value={targetFacilityId} onValueChange={setTargetFacilityId}>
                  <SelectTrigger id={`${__fieldIds}-target-facility`}><SelectValue placeholder="Select facility" /></SelectTrigger>
                  <SelectContent>
                    {(facilities.data ?? []).map((facility) => (
                      <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="lifecycle-reason">Reason</Label>
              <Textarea
                id="lifecycle-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this workforce transition is required"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWizardOpen(false)}>Cancel</Button>
            <Button disabled={createCase.isPending} onClick={() => void onCreate()}>
              {createCase.isPending ? "Creating…" : "Create case & preview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel lifecycle case</DialogTitle>
            <DialogDescription>Closed cases remain in the audit trail with the cancellation reason.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Cancellation reason</Label>
            <Textarea id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep case</Button>
            <Button
              variant="destructive"
              disabled={cancelReason.trim().length < 3 || cancelCase.isPending}
              onClick={() => void onCancel()}
            >
              Cancel case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
