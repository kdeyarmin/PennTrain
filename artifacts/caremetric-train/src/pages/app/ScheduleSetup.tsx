import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import {
  useListFacilityUnits, useCreateFacilityUnit, useUpdateFacilityUnit, useDeleteFacilityUnit, type FacilityUnit,
} from "@/hooks/useFacilityUnits";
import {
  useListShiftDefinitions, useCreateShiftDefinition, useUpdateShiftDefinition, useDeleteShiftDefinition, type ShiftDefinition,
} from "@/hooks/useShiftDefinitions";
import { useListEmployeeFacilityAssignments } from "@/hooks/useEmployeeFacilityAssignments";
import {
  useListEmployeeSchedulePreferences, useCreateEmployeeSchedulePreference, useDeleteEmployeeSchedulePreference,
  type EmployeeSchedulePreference,
} from "@/hooks/useEmployeeSchedulePreferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Trash2, Grid3x3, Clock, Star, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatTimeLabel, WEEKDAY_LABELS } from "@/lib/scheduleDates";
import { isSpecialCareUnit } from "@/lib/specialCareCompliance";

export default function ScheduleSetup() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { data: facilities } = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const [facilityId, setFacilityId] = useState<string>("");
  const activeFacilityId = facilityId || facilities?.[0]?.id || "";

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-1 -ml-2" onClick={() => navigate("/app/schedule")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Schedules
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Shifts, Units &amp; Patterns</h1>
        <p className="text-muted-foreground">
          Set up once per facility -- the schedule creator's Auto-Fill uses this to build schedules for you.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground shrink-0">Facility</Label>
        <Select value={activeFacilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select a facility" />
          </SelectTrigger>
          <SelectContent>
            {(facilities ?? []).map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeFacilityId && (
        <Tabs defaultValue="units">
          <TabsList>
            <TabsTrigger value="units">Units &amp; Wings</TabsTrigger>
            <TabsTrigger value="shifts">Shift Types</TabsTrigger>
            <TabsTrigger value="patterns">Typical Patterns</TabsTrigger>
          </TabsList>
          <TabsContent value="units" className="mt-4">
            <UnitsPanel facilityId={activeFacilityId} organizationId={user?.organizationId ?? ""} />
          </TabsContent>
          <TabsContent value="shifts" className="mt-4">
            <ShiftsPanel facilityId={activeFacilityId} organizationId={user?.organizationId ?? ""} />
          </TabsContent>
          <TabsContent value="patterns" className="mt-4">
            <PatternsPanel facilityId={activeFacilityId} organizationId={user?.organizationId ?? ""} />
          </TabsContent>
        </Tabs>
      )}

      {!activeFacilityId && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Select a facility to manage its units, shift types, and typical patterns.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UnitsPanel({ facilityId, organizationId }: { facilityId: string; organizationId: string }) {
  const { toast } = useToast();
  const { data: units, isLoading } = useListFacilityUnits({ facilityId });
  const create = useCreateFacilityUnit();
  const update = useUpdateFacilityUnit();
  const del = useDeleteFacilityUnit();
  const [name, setName] = useState("");

  function handleAdd() {
    if (!name.trim()) return;
    create.mutate(
      { organization_id: organizationId, facility_id: facilityId, name: name.trim(), sort_order: (units?.length ?? 0) },
      {
        onSuccess: () => setName(""),
        onError: (e: Error) => toast({ title: "Couldn't add unit", description: e.message, variant: "destructive" }),
      }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Grid3x3 className="h-4 w-4" /> Units &amp; Wings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="font-medium">Special-care designation workflow</p>
              <p className="text-xs text-muted-foreground">
                Include “Memory,” “Dementia,” “Special Care,” “SDCU,” or “Secured” in a unit name to mark it for dementia/special-care training, staffing coverage, disclosure, and inspection-readiness checks.
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Memory Care Wing, Wing A"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={create.isPending || !name.trim()}>
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !units || units.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No units yet -- add your facility's wings above.</p>
        ) : (
          <div className="space-y-2">
            {units.map((u: FacilityUnit) => (
              <div key={u.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{u.name}</span>
                  {isSpecialCareUnit(u) && <Badge variant="outline">Special care</Badge>}
                  {!u.is_active && <Badge variant="secondary">Inactive</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: u.id, is_active: !u.is_active })}>
                    {u.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => del.mutate(u.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const COLOR_PRESETS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4"];

function ShiftsPanel({ facilityId, organizationId }: { facilityId: string; organizationId: string }) {
  const { toast } = useToast();
  const { data: shifts, isLoading } = useListShiftDefinitions({ facilityId });
  const create = useCreateShiftDefinition();
  const update = useUpdateShiftDefinition();
  const del = useDeleteShiftDefinition();
  const [form, setForm] = useState({ name: "", startTime: "07:00", endTime: "15:00", color: COLOR_PRESETS[0] });
  const [deleteTarget, setDeleteTarget] = useState<ShiftDefinition | null>(null);

  function handleAdd() {
    if (!form.name.trim()) return;
    create.mutate(
      {
        organization_id: organizationId,
        facility_id: facilityId,
        name: form.name.trim(),
        start_time: form.startTime,
        end_time: form.endTime,
        color: form.color,
        sort_order: shifts?.length ?? 0,
      },
      {
        onSuccess: () => setForm({ name: "", startTime: "07:00", endTime: "15:00", color: COLOR_PRESETS[0] }),
        onError: (e: Error) => toast({ title: "Couldn't add shift type", description: e.message, variant: "destructive" }),
      }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> Shift Types</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input placeholder="e.g. Day, Evening, Night" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Start</Label>
            <Input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">End</Label>
            <Input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Color</Label>
            <div className="flex gap-1">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="h-8 w-8 rounded-full border-2"
                  style={{ backgroundColor: c, borderColor: form.color === c ? "black" : "transparent" }}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                />
              ))}
            </div>
          </div>
          <Button onClick={handleAdd} disabled={create.isPending || !form.name.trim()}>
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !shifts || shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No shift types yet -- add your typical shifts above.</p>
        ) : (
          <div className="space-y-2">
            {shifts.map((s: ShiftDefinition) => (
              <div key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: s.color ?? "#94a3b8" }} />
                  <span className="font-medium">{s.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatTimeLabel(s.start_time)}–{formatTimeLabel(s.end_time)}
                  </span>
                  {!s.is_active && <Badge variant="secondary">Inactive</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: s.id, is_active: !s.is_active })}>
                    {s.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(s)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shift Type</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteTarget?.name}"? Every employee's typical-pattern preference built on this shift
              type will be permanently removed too (shift_definition_id cascades on delete). This can't be
              undone -- consider "Deactivate" instead if you just want to stop it from being offered for new
              patterns while keeping past schedules and preferences intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deleteTarget) return;
                del.mutate(deleteTarget.id, {
                  onError: (e: Error) => toast({ title: "Couldn't delete shift type", description: e.message, variant: "destructive" }),
                });
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function PatternsPanel({ facilityId, organizationId }: { facilityId: string; organizationId: string }) {
  const { toast } = useToast();
  const { data: roster } = useListEmployeeFacilityAssignments({ facilityId });
  const { data: units } = useListFacilityUnits({ facilityId });
  const { data: shiftDefs } = useListShiftDefinitions({ facilityId });
  const [employeeIds, setEmployeeIds] = useState<Set<string>>(new Set());

  // Browsing/managing existing patterns only makes sense for exactly one employee at a time --
  // useListEmployeeSchedulePreferences takes a single employeeId, so that list (below) only shows
  // once exactly one employee is checked above.
  const singleEmployeeId = employeeIds.size === 1 ? [...employeeIds][0] : undefined;
  const { data: preferences } = useListEmployeeSchedulePreferences({ employeeId: singleEmployeeId, facilityId });
  const create = useCreateEmployeeSchedulePreference();
  const del = useDeleteEmployeeSchedulePreference();

  const activeRoster = useMemo(() => (roster ?? []).filter((r) => r.employees && r.employees.status === "active"), [roster]);
  const activeUnits = useMemo(() => (units ?? []).filter((u) => u.is_active), [units]);
  const activeShiftDefs = useMemo(() => (shiftDefs ?? []).filter((s) => s.is_active), [shiftDefs]);

  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [shiftDefinitionId, setShiftDefinitionId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [addingPattern, setAddingPattern] = useState(false);

  function toggleDay(day: number) {
    setSelectedDays((d) => (d.includes(day) ? d.filter((x) => x !== day) : [...d, day].sort()));
  }

  function toggleEmployee(id: string) {
    setEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allRosterSelected = activeRoster.length > 0 && activeRoster.every((r) => employeeIds.has(r.employee_id));
  const someRosterSelected = activeRoster.some((r) => employeeIds.has(r.employee_id));

  function toggleSelectAllRoster() {
    setEmployeeIds(allRosterSelected ? new Set() : new Set(activeRoster.map((r) => r.employee_id)));
  }

  const singleEmployeeRoster = singleEmployeeId ? activeRoster.find((r) => r.employee_id === singleEmployeeId) : undefined;
  const patternTargetLabel =
    employeeIds.size === 1
      ? singleEmployeeRoster
        ? `${singleEmployeeRoster.employees?.first_name} ${singleEmployeeRoster.employees?.last_name}`
        : "this employee"
      : `${employeeIds.size} employees`;

  // Applies the same pattern to every selected employee in one batch via Promise.allSettled (so
  // one employee's failure doesn't block the rest), then reports one summary toast -- mirrors the
  // bulk-assignment pattern used elsewhere in this app (e.g. CourseAssignments' Assign Training).
  async function handleAdd() {
    if (employeeIds.size === 0 || !shiftDefinitionId || selectedDays.length === 0) {
      toast({ title: "Pick at least one employee, day, and shift", variant: "destructive" });
      return;
    }
    const targets = [...employeeIds];
    setAddingPattern(true);
    const results = await Promise.allSettled(
      targets.map((employeeId) =>
        create.mutateAsync({
          organization_id: organizationId,
          employee_id: employeeId,
          facility_id: facilityId,
          unit_id: unitId || null,
          shift_definition_id: shiftDefinitionId,
          days_of_week: selectedDays,
        })
      )
    );
    setAddingPattern(false);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - succeeded;
    if (targets.length === 1) {
      const [only] = results;
      if (only.status === "fulfilled") {
        toast({ title: "Pattern added", variant: "success" });
      } else {
        const reason = only.reason instanceof Error ? only.reason.message : String(only.reason);
        toast({ title: "Couldn't add pattern", description: reason, variant: "destructive" });
      }
    } else {
      toast({
        title: failed === 0 ? "Pattern added" : succeeded === 0 ? "Couldn't add pattern" : "Pattern partially added",
        description:
          `${succeeded} of ${targets.length} employees updated successfully.` + (failed > 0 ? ` ${failed} failed.` : ""),
        variant: failed === 0 ? "success" : succeeded === 0 ? "destructive" : undefined,
      });
    }
    if (succeeded > 0) {
      setSelectedDays([]);
      setShiftDefinitionId("");
      setUnitId("");
    }
  }

  const shiftById = new Map(activeShiftDefs.map((s) => [s.id, s]));
  const unitById = new Map(activeUnits.map((u) => [u.id, u]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Star className="h-4 w-4" /> Typical Patterns</CardTitle>
        <p className="text-sm text-muted-foreground">
          Tell us who typically works which days, shift, and unit -- Auto-Fill uses this to build new schedules
          without you arranging every cell by hand.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 max-w-sm">
          <Label className="text-xs">Employees ({employeeIds.size} selected)</Label>
          <div className="border rounded-md overflow-hidden">
            <label className="flex items-center gap-2 px-2.5 py-1.5 text-xs border-b bg-muted/40 cursor-pointer">
              <Checkbox
                checked={allRosterSelected ? true : someRosterSelected ? "indeterminate" : false}
                onCheckedChange={toggleSelectAllRoster}
                aria-label="Select all visible employees"
              />
              <span className="text-muted-foreground">Select all visible ({activeRoster.length})</span>
            </label>
            <div className="max-h-48 overflow-y-auto divide-y">
              {activeRoster.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No active employees at this facility.</p>
              ) : (
                activeRoster.map((r) => (
                  <label key={r.employee_id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
                    <Checkbox checked={employeeIds.has(r.employee_id)} onCheckedChange={() => toggleEmployee(r.employee_id)} />
                    <span className="flex-1 truncate">{r.employees?.first_name} {r.employees?.last_name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        {employeeIds.size > 0 && (
          <>
            <div className="rounded-md border p-4 space-y-3">
              <Label className="text-xs">Add a pattern for {patternTargetLabel}</Label>
              <div className="flex flex-wrap gap-3">
                {WEEKDAY_LABELS.map((label, i) => (
                  <label key={i} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={selectedDays.includes(i)} onCheckedChange={() => toggleDay(i)} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select value={shiftDefinitionId} onValueChange={setShiftDefinitionId}>
                  <SelectTrigger><SelectValue placeholder="Shift" /></SelectTrigger>
                  <SelectContent>
                    {activeShiftDefs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger><SelectValue placeholder="Unit (optional)" /></SelectTrigger>
                  <SelectContent>
                    {activeUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAdd} disabled={addingPattern}>
                <Plus className="h-4 w-4 mr-2" />
                {addingPattern ? "Adding..." : employeeIds.size > 1 ? `Add Pattern to ${employeeIds.size} Employees` : "Add Pattern"}
              </Button>
            </div>

            {singleEmployeeId && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Existing patterns</Label>
                {(preferences ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No typical patterns yet for this employee.</p>
                ) : (
                  (preferences ?? []).map((p: EmployeeSchedulePreference) => (
                    <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="text-sm">
                        <span className="font-medium">
                          {p.days_of_week.map((d) => WEEKDAY_LABELS[d]).join(", ")}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}&middot; {shiftById.get(p.shift_definition_id)?.name ?? "—"}
                          {p.unit_id ? ` · ${unitById.get(p.unit_id)?.name ?? "—"}` : ""}
                        </span>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => del.mutate(p.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
