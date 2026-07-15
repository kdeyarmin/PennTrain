import { useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/QueryState";
import {
  useFacilityLicensing,
  useSaveFacilityLicensingRecord,
  type LicensingRecord,
} from "@/hooks/useFacilityLicensing";
import { useToast } from "@/hooks/use-toast";
import { toLocalIsoDate } from "@/lib/dateUtils";

type Kind = "license" | "condition" | "waiver" | "filing";
type Form = Record<string, string>;
const human = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function dueTone(date: unknown) {
  if (!date) return "outline" as const;
  const days = Math.ceil(
    (new Date(String(date)).getTime() - Date.now()) / 86_400_000,
  );
  return days < 0
    ? ("destructive" as const)
    : days <= 60
      ? ("secondary" as const)
      : ("outline" as const);
}

export function FacilityLicensingWorkspace({
  facilityId,
  facilityType,
  canManage,
}: {
  facilityId: string;
  facilityType: string;
  canManage: boolean;
}) {
  const workspace = useFacilityLicensing(facilityId);
  const save = useSaveFacilityLicensingRecord();
  const { toast } = useToast();
  const [editor, setEditor] = useState<{ kind: Kind; form: Form } | null>(null);
  const [reason, setReason] = useState("");
  const data = workspace.data;
  const currentLicense = data?.licenses.find((item) =>
    ["pending", "active", "provisional", "conditional", "suspended"].includes(
      String(item.status),
    ),
  );
  const dueFilings =
    data?.filings.filter(
      (item) =>
        !["accepted", "not_required"].includes(String(item.status)) &&
        String(item.due_on) <=
          toLocalIsoDate(new Date(Date.now() + 90 * 86_400_000)),
    ).length ?? 0;
  const dueWaivers =
    data?.waivers.filter(
      (item) =>
        ["requested", "active"].includes(String(item.status)) &&
        String(item.renewal_due_on ?? item.expires_on ?? "9999-12-31") <=
          toLocalIsoDate(new Date(Date.now() + 90 * 86_400_000)),
    ).length ?? 0;

  const openEditor = (kind: Kind, record?: LicensingRecord) => {
    const common = record
      ? Object.fromEntries(
          Object.entries(record).map(([key, value]) => [
            key,
            value == null ? "" : String(value),
          ]),
        )
      : {};
    if (kind === "license")
      setEditor({
        kind,
        form: {
          id: common.id ?? "",
          licenseType:
            common.license_type ??
            (facilityType === "PCH"
              ? "personal_care_home"
              : facilityType === "ALR"
                ? "assisted_living_residence"
                : "other"),
          licenseNumber: common.license_number ?? "",
          status: common.status ?? "active",
          issuedOn: common.issued_on ?? "",
          effectiveFrom: common.effective_from ?? toLocalIsoDate(),
          expiresOn: common.expires_on ?? "",
          licensedCapacity: common.licensed_capacity ?? "",
          issuingAuthority:
            common.issuing_authority ??
            "Pennsylvania Department of Human Services",
          documentLabel: common.certificate_document_label ?? "",
          storagePath: common.certificate_storage_path ?? "",
          notes: common.notes ?? "",
        },
      });
    if (kind === "condition")
      setEditor({
        kind,
        form: {
          id: common.id ?? "",
          licenseId: common.facility_license_id ?? currentLicense?.id ?? "",
          conditionType: common.condition_type ?? "conditional",
          description: common.description ?? "",
          imposedOn: common.imposed_on ?? toLocalIsoDate(),
          reviewDueOn: common.review_due_on ?? "",
          resolvedOn: common.resolved_on ?? "",
          status: common.status ?? "open",
          authorityReference: common.authority_reference ?? "",
        },
      });
    if (kind === "waiver")
      setEditor({
        kind,
        form: {
          id: common.id ?? "",
          licenseId: common.facility_license_id ?? currentLicense?.id ?? "",
          citation: common.regulation_citation ?? "",
          scope: common.scope_summary ?? "",
          status: common.status ?? "active",
          requestedOn: common.requested_on ?? "",
          issuedOn: common.issued_on ?? "",
          effectiveFrom: common.effective_from ?? "",
          expiresOn: common.expires_on ?? "",
          renewalDueOn: common.renewal_due_on ?? "",
          authorityReference: common.authority_reference ?? "",
          documentLabel: common.evidence_document_label ?? "",
          storagePath: common.evidence_storage_path ?? "",
          conditions: common.conditions ?? "",
        },
      });
    if (kind === "filing")
      setEditor({
        kind,
        form: {
          id: common.id ?? "",
          licenseId: common.facility_license_id ?? currentLicense?.id ?? "",
          filingType: common.filing_type ?? "license_renewal",
          title: common.title ?? "",
          dueOn: common.due_on ?? "",
          status: common.status ?? "not_started",
          submittedOn: common.submitted_on ?? "",
          acceptedOn: common.accepted_on ?? "",
          confirmationReference: common.confirmation_reference ?? "",
          documentLabel: common.evidence_document_label ?? "",
          storagePath: common.evidence_storage_path ?? "",
          notes: common.notes ?? "",
        },
      });
    setReason("");
  };

  const submit = async () => {
    if (!editor || reason.trim().length < 5) return;
    try {
      await save.mutateAsync({
        facilityId,
        kind: editor.kind,
        payload: editor.form,
        reason: reason.trim(),
      });
      setEditor(null);
      toast({ title: `${human(editor.kind)} record saved` });
    } catch (error) {
      toast({
        title: "Licensing record blocked",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  if (workspace.isError)
    return (
      <QueryError
        what="facility licensing"
        error={workspace.error}
        onRetry={() => workspace.refetch()}
      />
    );
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Facility licensing and regulatory filings
            </CardTitle>
            <CardDescription>
              Certificate lifecycle, provisional or conditional terms, waivers,
              deadlines, evidence references, and immutable change history.
            </CardDescription>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => openEditor("license")}>
                <Plus className="mr-2 h-4 w-4" />
                License
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openEditor("condition")}
                disabled={!currentLicense}
              >
                Condition
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openEditor("waiver")}
              >
                Waiver
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openEditor("filing")}
              >
                Filing
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {workspace.isLoading ? (
          <div className="h-40 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  Current certificate
                </p>
                <p className="mt-1 font-semibold">
                  {currentLicense?.license_number ?? "Not recorded"}
                </p>
                {currentLicense ? (
                  <Badge
                    className="mt-2"
                    variant={
                      currentLicense.status === "active"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {human(String(currentLicense.status))}
                  </Badge>
                ) : null}
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  Filings due in 90 days
                </p>
                <p className="mt-1 text-2xl font-semibold">{dueFilings}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  Waiver actions due
                </p>
                <p className="mt-1 text-2xl font-semibold">{dueWaivers}</p>
              </div>
            </div>
            <Tabs defaultValue="licenses">
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="licenses">Licenses</TabsTrigger>
                <TabsTrigger value="conditions">Conditions</TabsTrigger>
                <TabsTrigger value="waivers">Waivers</TabsTrigger>
                <TabsTrigger value="filings">Filings</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="licenses">
                <RecordList
                  items={data?.licenses ?? []}
                  primary="license_number"
                  status="status"
                  date="expires_on"
                  empty="No certificate history recorded."
                  onEdit={
                    canManage
                      ? (item) => openEditor("license", item)
                      : undefined
                  }
                />
              </TabsContent>
              <TabsContent value="conditions">
                <RecordList
                  items={data?.conditions ?? []}
                  primary="description"
                  status="status"
                  date="review_due_on"
                  empty="No license conditions recorded."
                  onEdit={
                    canManage
                      ? (item) => openEditor("condition", item)
                      : undefined
                  }
                />
              </TabsContent>
              <TabsContent value="waivers">
                <RecordList
                  items={data?.waivers ?? []}
                  primary="regulation_citation"
                  status="status"
                  date="renewal_due_on"
                  empty="No waivers recorded."
                  onEdit={
                    canManage ? (item) => openEditor("waiver", item) : undefined
                  }
                />
              </TabsContent>
              <TabsContent value="filings">
                <RecordList
                  items={data?.filings ?? []}
                  primary="title"
                  status="status"
                  date="due_on"
                  empty="No regulatory filings scheduled."
                  onEdit={
                    canManage ? (item) => openEditor("filing", item) : undefined
                  }
                />
              </TabsContent>
              <TabsContent value="history">
                <RecordList
                  items={data?.history ?? []}
                  primary="summary"
                  status="event_type"
                  date="occurred_at"
                  empty="No licensing history yet."
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </CardContent>
      <LicensingEditor
        editor={editor}
        setEditor={setEditor}
        reason={reason}
        setReason={setReason}
        pending={save.isPending}
        onSubmit={submit}
      />
    </Card>
  );
}

function RecordList({
  items,
  primary,
  status,
  date,
  empty,
  onEdit,
}: {
  items: LicensingRecord[];
  primary: string;
  status: string;
  date: string;
  empty: string;
  onEdit?: (item: LicensingRecord) => void;
}) {
  if (!items.length)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
    );
  return (
    <div className="mt-3 space-y-2">
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          onClick={() => onEdit?.(item)}
          disabled={!onEdit}
          className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-left enabled:hover:bg-muted"
        >
          <div>
            <p className="font-medium">{String(item[primary] ?? "Record")}</p>
            {item[date] ? (
              <p className="text-xs text-muted-foreground">
                {date === "occurred_at"
                  ? new Date(String(item[date])).toLocaleString()
                  : `Due / expires ${String(item[date])}`}
              </p>
            ) : null}
          </div>
          <Badge variant={dueTone(item[date])}>
            {human(String(item[status] ?? "recorded"))}
          </Badge>
        </button>
      ))}
    </div>
  );
}

function LicensingEditor({
  editor,
  setEditor,
  reason,
  setReason,
  pending,
  onSubmit,
}: {
  editor: { kind: Kind; form: Form } | null;
  setEditor: (value: { kind: Kind; form: Form } | null) => void;
  reason: string;
  setReason: (value: string) => void;
  pending: boolean;
  onSubmit: () => void;
}) {
  const set = (key: string, value: string) =>
    setEditor(
      editor ? { ...editor, form: { ...editor.form, [key]: value } } : null,
    );
  const f = editor?.form ?? {};
  return (
    <Dialog
      open={Boolean(editor)}
      onOpenChange={(open) => !open && setEditor(null)}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editor?.form.id ? "Update" : "Add"}{" "}
            {editor ? human(editor.kind) : "record"}
          </DialogTitle>
          <DialogDescription>
            Dates and evidence references drive the facility deadline queue.
            Every save appends an immutable history entry.
          </DialogDescription>
        </DialogHeader>
        {editor ? (
          <div className="grid gap-3 py-2 sm:grid-cols-2">
            {editor.kind === "license" ? (
              <>
                <Field label="License type">
                  <Choice
                    value={f.licenseType}
                    set={(v) => set("licenseType", v)}
                    values={[
                      "personal_care_home",
                      "assisted_living_residence",
                      "other",
                    ]}
                  />
                </Field>
                <Field label="License number">
                  <Input
                    value={f.licenseNumber}
                    onChange={(e) => set("licenseNumber", e.target.value)}
                  />
                </Field>
                <Field label="Status">
                  <Choice
                    value={f.status}
                    set={(v) => set("status", v)}
                    values={[
                      "pending",
                      "active",
                      "provisional",
                      "conditional",
                      "suspended",
                      "expired",
                      "closed",
                    ]}
                  />
                </Field>
                <Field label="Issued on">
                  <Input
                    type="date"
                    value={f.issuedOn}
                    onChange={(e) => set("issuedOn", e.target.value)}
                  />
                </Field>
                <Field label="Effective from">
                  <Input
                    type="date"
                    value={f.effectiveFrom}
                    onChange={(e) => set("effectiveFrom", e.target.value)}
                  />
                </Field>
                <Field label="Expires on">
                  <Input
                    type="date"
                    value={f.expiresOn}
                    onChange={(e) => set("expiresOn", e.target.value)}
                  />
                </Field>
                <Field label="Licensed capacity">
                  <Input
                    type="number"
                    min="0"
                    value={f.licensedCapacity}
                    onChange={(e) => set("licensedCapacity", e.target.value)}
                  />
                </Field>
                <Field label="Issuing authority">
                  <Input
                    value={f.issuingAuthority}
                    onChange={(e) => set("issuingAuthority", e.target.value)}
                  />
                </Field>
                <Field label="Evidence label">
                  <Input
                    value={f.documentLabel}
                    onChange={(e) => set("documentLabel", e.target.value)}
                  />
                </Field>
                <Field label="Evidence storage path">
                  <Input
                    value={f.storagePath}
                    onChange={(e) => set("storagePath", e.target.value)}
                  />
                </Field>
                <Field label="Notes" span>
                  <Textarea
                    value={f.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {editor.kind === "condition" ? (
              <>
                <Field label="Condition type">
                  <Choice
                    value={f.conditionType}
                    set={(v) => set("conditionType", v)}
                    values={[
                      "provisional",
                      "conditional",
                      "restriction",
                      "corrective_action",
                      "other",
                    ]}
                  />
                </Field>
                <Field label="Status">
                  <Choice
                    value={f.status}
                    set={(v) => set("status", v)}
                    values={["open", "monitoring", "satisfied", "lifted"]}
                  />
                </Field>
                <Field label="Description" span>
                  <Textarea
                    value={f.description}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </Field>
                <Field label="Imposed on">
                  <Input
                    type="date"
                    value={f.imposedOn}
                    onChange={(e) => set("imposedOn", e.target.value)}
                  />
                </Field>
                <Field label="Review due">
                  <Input
                    type="date"
                    value={f.reviewDueOn}
                    onChange={(e) => set("reviewDueOn", e.target.value)}
                  />
                </Field>
                <Field label="Resolved on">
                  <Input
                    type="date"
                    value={f.resolvedOn}
                    onChange={(e) => set("resolvedOn", e.target.value)}
                  />
                </Field>
                <Field label="Authority reference">
                  <Input
                    value={f.authorityReference}
                    onChange={(e) => set("authorityReference", e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {editor.kind === "waiver" ? (
              <>
                <Field label="Regulation citation">
                  <Input
                    value={f.citation}
                    onChange={(e) => set("citation", e.target.value)}
                  />
                </Field>
                <Field label="Status">
                  <Choice
                    value={f.status}
                    set={(v) => set("status", v)}
                    values={[
                      "requested",
                      "active",
                      "denied",
                      "expired",
                      "revoked",
                      "superseded",
                    ]}
                  />
                </Field>
                <Field label="Scope" span>
                  <Textarea
                    value={f.scope}
                    onChange={(e) => set("scope", e.target.value)}
                  />
                </Field>
                <Field label="Requested on">
                  <Input
                    type="date"
                    value={f.requestedOn}
                    onChange={(e) => set("requestedOn", e.target.value)}
                  />
                </Field>
                <Field label="Issued on">
                  <Input
                    type="date"
                    value={f.issuedOn}
                    onChange={(e) => set("issuedOn", e.target.value)}
                  />
                </Field>
                <Field label="Effective from">
                  <Input
                    type="date"
                    value={f.effectiveFrom}
                    onChange={(e) => set("effectiveFrom", e.target.value)}
                  />
                </Field>
                <Field label="Expires on">
                  <Input
                    type="date"
                    value={f.expiresOn}
                    onChange={(e) => set("expiresOn", e.target.value)}
                  />
                </Field>
                <Field label="Renewal due">
                  <Input
                    type="date"
                    value={f.renewalDueOn}
                    onChange={(e) => set("renewalDueOn", e.target.value)}
                  />
                </Field>
                <Field label="Authority reference">
                  <Input
                    value={f.authorityReference}
                    onChange={(e) => set("authorityReference", e.target.value)}
                  />
                </Field>
                <Field label="Evidence label">
                  <Input
                    value={f.documentLabel}
                    onChange={(e) => set("documentLabel", e.target.value)}
                  />
                </Field>
                <Field label="Evidence storage path">
                  <Input
                    value={f.storagePath}
                    onChange={(e) => set("storagePath", e.target.value)}
                  />
                </Field>
                <Field label="Conditions" span>
                  <Textarea
                    value={f.conditions}
                    onChange={(e) => set("conditions", e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {editor.kind === "filing" ? (
              <>
                <Field label="Filing type">
                  <Choice
                    value={f.filingType}
                    set={(v) => set("filingType", v)}
                    values={[
                      "license_renewal",
                      "annual_report",
                      "fee",
                      "census",
                      "ownership_change",
                      "administrator_change",
                      "capacity_change",
                      "other",
                    ]}
                  />
                </Field>
                <Field label="Status">
                  <Choice
                    value={f.status}
                    set={(v) => set("status", v)}
                    values={[
                      "not_started",
                      "in_progress",
                      "submitted",
                      "accepted",
                      "rejected",
                      "not_required",
                    ]}
                  />
                </Field>
                <Field label="Title" span>
                  <Input
                    value={f.title}
                    onChange={(e) => set("title", e.target.value)}
                  />
                </Field>
                <Field label="Due on">
                  <Input
                    type="date"
                    value={f.dueOn}
                    onChange={(e) => set("dueOn", e.target.value)}
                  />
                </Field>
                <Field label="Submitted on">
                  <Input
                    type="date"
                    value={f.submittedOn}
                    onChange={(e) => set("submittedOn", e.target.value)}
                  />
                </Field>
                <Field label="Accepted on">
                  <Input
                    type="date"
                    value={f.acceptedOn}
                    onChange={(e) => set("acceptedOn", e.target.value)}
                  />
                </Field>
                <Field label="Confirmation reference">
                  <Input
                    value={f.confirmationReference}
                    onChange={(e) =>
                      set("confirmationReference", e.target.value)
                    }
                  />
                </Field>
                <Field label="Evidence label">
                  <Input
                    value={f.documentLabel}
                    onChange={(e) => set("documentLabel", e.target.value)}
                  />
                </Field>
                <Field label="Evidence storage path">
                  <Input
                    value={f.storagePath}
                    onChange={(e) => set("storagePath", e.target.value)}
                  />
                </Field>
                <Field label="Notes" span>
                  <Textarea
                    value={f.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            <Field label="Change reason" span>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why this record is being added or changed"
              />
            </Field>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditor(null)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={reason.trim().length < 5 || pending}
          >
            Save record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  span = false,
}: {
  label: string;
  children: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div className={`space-y-1 ${span ? "sm:col-span-2" : ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Choice({
  value,
  set,
  values,
}: {
  value: string;
  set: (value: string) => void;
  values: string[];
}) {
  return (
    <Select value={value} onValueChange={set}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map((value) => (
          <SelectItem key={value} value={value}>
            {human(value)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
