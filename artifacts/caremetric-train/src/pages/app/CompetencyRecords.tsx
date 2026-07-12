import { useEffect, useMemo, useState } from "react";
import {
  useListCompetencyRecords,
  useCreateCompetencyRecord,
  useListCompetencyTemplates,
  useListCompetencyTemplateItems,
  useListCompetencyRecordItems,
  type CompetencyRecord,
} from "@/hooks/useCompetencies";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListProfiles } from "@/hooks/useProfiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, ChevronLeft, ChevronRight, Plus, Eye } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { formatDateForDisplay, toLocalIsoDate } from "@/lib/dateUtils";

const PAGE_SIZE = 15;

const OVERALL_RESULT_OPTIONS = ["met", "not_met", "partial"] as const;
type OverallResult = (typeof OVERALL_RESULT_OPTIONS)[number];

const ITEM_RESULT_OPTIONS = ["met", "not_met", "na"] as const;
type ItemResult = (typeof ITEM_RESULT_OPTIONS)[number];

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function ResultBadge({ result }: { result: string }) {
  const className =
    result === "met"
      ? "bg-success text-success-foreground hover:bg-success/80"
      : result === "not_met"
        ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
        : result === "partial"
          ? "bg-warning text-warning-foreground hover:bg-warning/80"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"; // na
  return (
    <Badge className={className} variant="outline">
      {humanize(result)}
    </Badge>
  );
}

interface RecordFormData {
  employeeId: string;
  templateId: string;
  evaluationDate: string;
  overallResult: OverallResult;
  signNow: boolean;
}

const EMPTY_RECORD_FORM: RecordFormData = {
  employeeId: "",
  templateId: "",
  evaluationDate: toLocalIsoDate(),
  overallResult: "met",
  signNow: false,
};

// ---------------------------------------------------------------------------
// Read-only detail view. Employees only ever reach a record through this same
// shape (see the "My Competency Records" card on EmployeeDashboard.tsx), so
// keeping the detail rendering here rather than duplicating it keeps both
// surfaces showing identical information.
// ---------------------------------------------------------------------------
function RecordDetailDialog({ record, onClose }: { record: CompetencyRecord | null; onClose: () => void }) {
  const { data: recordItems, isLoading: itemsLoading } = useListCompetencyRecordItems(record?.id);
  const { data: templateItems } = useListCompetencyTemplateItems(record?.template_id);
  const { data: employees } = useListEmployees();
  const { data: templates } = useListCompetencyTemplates();
  const { data: evaluators } = useListProfiles();

  const employee = employees?.find((e) => e.id === record?.employee_id);
  const template = templates?.find((t) => t.id === record?.template_id);
  const evaluator = evaluators?.find((p) => p.id === record?.evaluator_profile_id);
  const itemTextById = new Map((templateItems ?? []).map((i) => [i.id, i.item_text]));

  return (
    <Dialog open={!!record} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Competency Evaluation</DialogTitle>
        </DialogHeader>
        {record && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Employee</p>
                <p className="font-medium">{employee ? `${employee.first_name} ${employee.last_name}` : `Employee #${record.employee_id.slice(0, 8)}`}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Template</p>
                <p className="font-medium">{template?.name ?? `Template #${record.template_id.slice(0, 8)}`}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Evaluation Date</p>
                <p>{formatDateForDisplay(record.evaluation_date)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Evaluator</p>
                <p>{evaluator ? `${evaluator.first_name} ${evaluator.last_name}` : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Overall Result</p>
                <ResultBadge result={record.overall_result} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Signature</p>
                <p>{record.signed_at ? `Signed ${new Date(record.signed_at).toLocaleString()}` : "Not signed"}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Checklist Items</p>
              {itemsLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
                </div>
              ) : !recordItems || recordItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No checklist items were recorded.</p>
              ) : (
                <div className="space-y-1.5">
                  {recordItems.map((item) => (
                    <div key={item.id} className="p-2.5 rounded-lg border">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm flex-1">
                          {item.template_item_id ? (itemTextById.get(item.template_item_id) ?? "Item removed from template") : "Item removed from template"}
                        </span>
                        <ResultBadge result={item.result} />
                      </div>
                      {item.notes && <p className="text-xs text-muted-foreground mt-1">{item.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CompetencyRecords() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [facilityFilter, setFacilityFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [templateFilter, setTemplateFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RecordFormData>(EMPTY_RECORD_FORM);
  const [itemResults, setItemResults] = useState<Record<string, { result: ItemResult; notes: string }>>({});
  const [viewRecord, setViewRecord] = useState<CompetencyRecord | null>(null);

  // Matches the competency_records RLS insert/update policy role set exactly
  // (org_admin, facility_manager, trainer) -- an employee can view their own
  // records (owns_employee() in the SELECT policy) but the DB flatly has no
  // insert/update path for them, so this page must never show them the form.
  const canManage = ["org_admin", "facility_manager", "trainer"].includes(user?.role ?? "");

  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees();
  const { data: templates } = useListCompetencyTemplates();
  const { data: records, isLoading } = useListCompetencyRecords({
    facilityId: facilityFilter !== "all" ? facilityFilter : undefined,
    employeeId: employeeFilter !== "all" ? employeeFilter : undefined,
    templateId: templateFilter !== "all" ? templateFilter : undefined,
  });
  const { data: templateItems } = useListCompetencyTemplateItems(form.templateId || undefined);

  const { mutate: createRecord, isPending: creating } = useCreateCompetencyRecord();

  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const templateById = useMemo(() => new Map((templates ?? []).map((t) => [t.id, t])), [templates]);

  const activeEmployees = useMemo(
    () =>
      (employees ?? [])
        .filter((e) => e.status === "active")
        .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [employees],
  );

  const allRecords = records ?? [];
  const sorted = [...allRecords].sort((a, b) => b.evaluation_date.localeCompare(a.evaluation_date));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Keep itemResults in sync with whichever template is currently selected in
  // the form: seed a default ("met", no notes) for every checklist item the
  // first time it appears, and preserve anything already entered if the same
  // template's item list re-fetches.
  useEffect(() => {
    if (!templateItems) {
      setItemResults({});
      return;
    }
    setItemResults((prev) => {
      const next: typeof prev = {};
      for (const item of templateItems) {
        next[item.id] = prev[item.id] ?? { result: "met", notes: "" };
      }
      return next;
    });
  }, [templateItems]);

  const openCreate = () => {
    setForm(EMPTY_RECORD_FORM);
    setShowForm(true);
  };

  const setItemField = (itemId: string, field: "result" | "notes", value: string) =>
    setItemResults((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { result: "met", notes: "" }), [field]: value },
    }));

  const handleSubmit = () => {
    if (!form.employeeId || !form.templateId || !form.evaluationDate) {
      toast({ title: "Employee, template, and evaluation date are required", variant: "destructive" });
      return;
    }
    const employee = employeeById.get(form.employeeId);
    if (!employee) return;
    if (!templateItems || templateItems.length === 0) {
      toast({
        title: "This template has no checklist items",
        description: "Add items to the template before recording an evaluation against it.",
        variant: "destructive",
      });
      return;
    }

    const items = templateItems.map((item) => ({
      template_item_id: item.id,
      result: itemResults[item.id]?.result ?? "met",
      notes: itemResults[item.id]?.notes || null,
    }));

    createRecord(
      {
        employee_id: employee.id,
        // facility_id is NOT auto-corrected server-side for this table (see the
        // design note in useCompetencies.ts) -- it must be the employee's real
        // facility for the is_assigned_to_facility() RLS check to pass.
        facility_id: employee.facility_id,
        organization_id: employee.organization_id,
        template_id: form.templateId,
        evaluator_profile_id: user?.id ?? null,
        evaluation_date: form.evaluationDate,
        overall_result: form.overallResult,
        signed_at: form.signNow ? new Date().toISOString() : null,
        items,
      },
      {
        onSuccess: () => {
          toast({ title: "Competency evaluation recorded" });
          setShowForm(false);
          setForm(EMPTY_RECORD_FORM);
        },
        onError: (e: Error) => toast({ title: "Failed to record evaluation", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Competency Records</h1>
          <p>Conduct and review employee competency evaluations against checklist templates.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> New Evaluation
          </Button>
        )}
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <Select value={facilityFilter} onValueChange={(v) => { setFacilityFilter(v); setPage(1); }}>
            <SelectTrigger className="w-48 h-9 bg-card">
              <SelectValue placeholder="All Facilities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Facilities</SelectItem>
              {facilities?.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={employeeFilter} onValueChange={(v) => { setEmployeeFilter(v); setPage(1); }}>
            <SelectTrigger className="w-48 h-9 bg-card">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {(employees ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.last_name}, {e.first_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={templateFilter} onValueChange={(v) => { setTemplateFilter(v); setPage(1); }}>
            <SelectTrigger className="w-48 h-9 bg-card">
              <SelectValue placeholder="All Templates" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Templates</SelectItem>
              {(templates ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ClipboardCheck className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No competency records found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {canManage ? "Record a new evaluation to get started." : "Try adjusting your filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Template</th>
                    <th>Evaluation Date</th>
                    <th>Result</th>
                    <th>Signed</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((r) => {
                    const emp = employeeById.get(r.employee_id);
                    const template = templateById.get(r.template_id);
                    return (
                      <tr key={r.id}>
                        <td>
                          <span className="font-medium text-foreground">
                            {emp ? `${emp.last_name}, ${emp.first_name}` : `Employee #${r.employee_id.slice(0, 8)}`}
                          </span>
                        </td>
                        <td className="text-muted-foreground">{template?.name ?? `Template #${r.template_id.slice(0, 8)}`}</td>
                        <td className="text-muted-foreground">{formatDateForDisplay(r.evaluation_date)}</td>
                        <td><ResultBadge result={r.overall_result} /></td>
                        <td className="text-muted-foreground">{r.signed_at ? "Yes" : "No"}</td>
                        <td>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setViewRecord(r)} aria-label="View evaluation">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border/60">
              <p className="text-[13px] text-muted-foreground">
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)}</span> of {sorted.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[13px] text-muted-foreground px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <ClipboardCheck className="h-4 w-4" />
        <span>{allRecords.length} record{allRecords.length !== 1 ? "s" : ""} total</span>
      </div>

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Competency Evaluation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Employee *</Label>
                <Select value={form.employeeId} onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {activeEmployees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.last_name}, {e.first_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Template *</Label>
                <Select value={form.templateId} onValueChange={(v) => setForm((f) => ({ ...f, templateId: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select template" /></SelectTrigger>
                  <SelectContent>
                    {(templates ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Evaluation Date *</Label>
                <Input type="date" value={form.evaluationDate} onChange={(e) => setForm((f) => ({ ...f, evaluationDate: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Overall Result *</Label>
                <Select value={form.overallResult} onValueChange={(v) => setForm((f) => ({ ...f, overallResult: v as OverallResult }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OVERALL_RESULT_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>{humanize(o)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.templateId && (
              <div className="space-y-2">
                <Label className="text-[13px]">Checklist</Label>
                {!templateItems ? (
                  <div className="space-y-2">
                    {[...Array(2)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}
                  </div>
                ) : templateItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">This template has no checklist items yet.</p>
                ) : (
                  <div className="space-y-2">
                    {templateItems.map((item, idx) => {
                      const current = itemResults[item.id] ?? { result: "met" as ItemResult, notes: "" };
                      return (
                        <div key={item.id} className="p-3 rounded-lg border space-y-2">
                          <p className="text-sm font-medium">{idx + 1}. {item.item_text}</p>
                          <div className="flex items-center gap-3">
                            <Select value={current.result} onValueChange={(v) => setItemField(item.id, "result", v)}>
                              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {ITEM_RESULT_OPTIONS.map((o) => (
                                  <SelectItem key={o} value={o}>{humanize(o)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              value={current.notes}
                              onChange={(e) => setItemField(item.id, "notes", e.target.value)}
                              placeholder="Notes (optional)"
                              className="h-8 flex-1"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <label className="flex items-start gap-2.5 cursor-pointer pt-1">
              <Checkbox
                checked={form.signNow}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, signNow: checked === true }))}
                className="mt-0.5"
              />
              <span className="text-[13px]">
                Sign this evaluation now
                <span className="block text-xs text-muted-foreground">Records the current date and time as this evaluation's signature.</span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating} className="shadow-sm">
              {creating ? "Saving..." : "Save Evaluation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecordDetailDialog record={viewRecord} onClose={() => setViewRecord(null)} />
    </div>
  );
}
