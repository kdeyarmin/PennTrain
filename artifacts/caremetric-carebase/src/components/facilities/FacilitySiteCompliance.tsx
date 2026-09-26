import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useFacilitySitePolicy, useSaveFacilitySitePolicy, useFacilitySiteReviews, useAddFacilitySiteReview, useSiteSupportPlans, useSiteDrillRotation, type FacilitySiteReview } from "@/hooks/useFacilitySiteCompliance";
import { useListInspectionItems } from "@/hooks/useInspectionItems";
import { useListResidents } from "@/hooks/useResidents";
import { useListEmployees } from "@/hooks/useEmployees";
import { useFacilityTransportVehicles } from "@/hooks/useResidentServicesCalendar";
import { useResidentAgreements } from "@/hooks/useResidentAgreements";
import { useListDocuments, useUploadDocument, useDocumentSignedUrl } from "@/hooks/useDocuments";
import { BEDSIDE_FIELDS, VOICE_FIELDS, SITE_REVIEW_LABELS, siteDeadlines, drillWeekdayRotation, type SiteReviewType } from "@/lib/facilitySiteCompliance";
import { addFacilityCalendarDays, facilityDateTimeLocalToUtcIso, facilityToday, toFacilityDateTimeLocal } from "@/lib/dateUtils";
import { humanize } from "@/lib/utils";
import { openDocumentUrl } from "@/lib/openDocumentUrl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QueryError } from "@/components/QueryState";

type Props = { organizationId: string; facilityId: string; facilityType?: string };
type Option = { id: string; label: string };
function Choice({ label, value, options, change, disabled = false }: { label: string; value: string; options: Option[]; change: (value: string) => void; disabled?: boolean }) {
  return <label className="block space-y-1 text-sm"><span>{label}</span><select aria-label={label} className="w-full rounded-md border bg-background p-2" value={value} disabled={disabled} onChange={(e) => change(e.target.value)}><option value="">Select…</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
}
function Field({ label, value, change, type }: { label: string; value: string; change: (value: string) => void; type?: string }) {
  return <label className="block space-y-1 text-sm"><span>{label}</span>{type ? <Input aria-label={label} type={type} value={value} onChange={(e) => change(e.target.value)} /> : <Textarea aria-label={label} value={value} onChange={(e) => change(e.target.value)} />}</label>;
}

export function FacilitySiteCompliance(props: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const reviews = useFacilitySiteReviews(props.facilityId);
  const [open, setOpen] = useState(false);
  const [previous, setPrevious] = useState<FacilitySiteReview | null>(null);
  const [history, setHistory] = useState(false);
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const root = user?.role === "platform_admin" ? "admin" : "app";
  if (!["PCH", "ALR"].includes(props.facilityType ?? "")) return <Card><CardContent className="pt-6">The Pennsylvania device and site rules apply to PCH and ALF facilities.</CardContent></Card>;
  const superseded = new Set((reviews.data ?? []).map((row) => row.supersedes_id).filter(Boolean));
  return <div className="space-y-4">
    <SitePolicy {...props} canManage={canManage} />
    <DrillRotation facilityId={props.facilityId} />
    <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>Device, transport and fire-approval records</CardTitle>{canManage && <Button onClick={() => { setPrevious(null); setOpen(true); }}>Add review</Button>}</CardHeader><CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">Link actual plans, contracts and document copies. Reviews preserve prior evidence; use a follow-up for changes, removal, renewal or corrections. Periodic device dates follow your written procedure. Recording a DHS notice here does not send it.</p>
      <div className="flex flex-wrap gap-3 text-sm"><Link className="text-primary underline" href={`/app/inspections?facility=${props.facilityId}`}>Manage device and approval inspection items</Link><Link className="text-primary underline" href={`/app/resident-services-calendar?facility=${props.facilityId}`}>Manage vehicles and trips</Link></div>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />Show superseded history</label>
      {reviews.isError ? <QueryError what="site reviews" error={reviews.error} onRetry={() => void reviews.refetch()} /> : reviews.isLoading ? <p>Loading reviews…</p> : !reviews.data?.length ? <p className="text-sm">No linked reviews recorded. A generic inspection pass does not replace these lifecycle records.</p> : reviews.data.filter((row) => history || !superseded.has(row.id)).map((row) => <div className="rounded border p-3 text-sm space-y-2" key={row.id}>
        <div className="flex justify-between gap-2"><strong>{SITE_REVIEW_LABELS[row.review_type as SiteReviewType]} · {humanize(row.event_kind)}</strong><span>{facilityToday(new Date(row.occurred_at))}{superseded.has(row.id) ? " · superseded" : ""}</span></div>
        <p>{row.evidence}</p>
        {row.event_kind === "removed" && <p className="font-medium">Removed from use — {(row.details as Record<string, string>).removal_reason}</p>}
        {["withdrawn", "restricted"].includes(row.event_kind) && <p className="text-destructive font-medium">Fire approval {row.event_kind}; record the authority's restrictions and follow-up approval.</p>}
        {siteDeadlines(row).map((deadline) => <p key={deadline.label} className={deadline.late ? "text-destructive" : ""}>{deadline.label}: {deadline.due.includes("T") ? new Date(deadline.due).toLocaleString("en-US", { timeZone: "America/New_York" }) : deadline.due} · {deadline.completed ? deadline.timingReview ? "completed; review immediate-notice timing" : deadline.late ? "completed late" : "completed" : deadline.late ? "overdue" : "pending"}</p>)}
        <details><summary className="cursor-pointer">Recorded evidence and links</summary><dl className="mt-2 grid gap-1">{Object.entries(row.details as Record<string, string>).filter(([, value]) => value !== "").map(([key, value]) => <div key={key}><dt className="inline font-medium">{humanize(key)}: </dt><dd className="inline whitespace-pre-wrap">{String(value)}</dd></div>)}</dl>{row.resident_id && <Link className="block text-primary underline" href={`/${root}/residents/${row.resident_id}`}>Resident record</Link>}{row.inspection_item_id && <Link className="block text-primary underline" href={`/${root}/inspections/${row.inspection_item_id}`}>Inspection item</Link>}</details>
        {canManage && !superseded.has(row.id) && <Button size="sm" variant="outline" onClick={() => { setPrevious(row); setOpen(true); }}>Append follow-up / correction</Button>}
      </div>)}
    </CardContent></Card>
    {open && <ReviewDialog {...props} previous={previous} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); toast({ title: "Site review recorded" }); }} />}
  </div>;
}

function SitePolicy({ canManage, ...props }: Props & { canManage: boolean }) {
  const query = useFacilitySitePolicy(props.facilityId);
  const save = useSaveFacilitySitePolicy();
  const { toast } = useToast();
  const [failed, setFailed] = useState(false);
  const [grace, setGrace] = useState("strict");
  const [renewal, setRenewal] = useState("every_three_years");
  const [reason, setReason] = useState("");
  useEffect(() => { if (query.data !== undefined) { setFailed(query.data?.count_unsuccessful_pch_drills ?? false); setGrace(query.data?.inspection_grace ?? "strict"); setRenewal(query.data?.alf_approval_renewal ?? "every_three_years"); setReason(query.data?.rationale ?? ""); } }, [query.data]);
  return <Card><CardHeader><CardTitle>Site compliance policy</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">The strict defaults remain until a manager records a decision. Choosing RCG grace changes overdue classification, not the due date. Monthly fire drills and extinguishers receive no grace. Evacuation-time violations remain recorded under every policy.</p>
    {query.isError ? <QueryError what="site policy" error={query.error} onRetry={() => void query.refetch()} /> : <fieldset disabled={!canManage || query.isLoading || save.isPending} className="space-y-3">
      {props.facilityType === "PCH" && <label className="flex gap-2 text-sm"><input type="checkbox" checked={failed} onChange={(e) => setFailed(e.target.checked)} />Count recorded unsuccessful PCH drills toward monthly / sleeping-hours frequency (PCH RCG)</label>}
      <Choice label="Inspection grace" value={grace} change={setGrace} options={[{ id: "strict", label: "Due date without grace" }, { id: "rcg", label: "RCG: 15 days annual / 5 days shorter intervals, with exclusions" }]} />
      {props.facilityType === "ALR" && <Choice label="ALF fire approval renewal" value={renewal} change={setRenewal} options={[{ id: "every_three_years", label: "Every three years (§2800.14(e))" }, { id: "changed_use", label: "When building use changed in the past three years (RCG)" }]} />}
      <Field label="Decision and source / stricter facility policy" value={reason} change={setReason} />
      {canManage && <Button disabled={reason.trim().length < 5} onClick={() => save.mutate({ facility_id: props.facilityId, organization_id: props.organizationId, count_unsuccessful_pch_drills: props.facilityType === "PCH" && failed, inspection_grace: grace, alf_approval_renewal: renewal, rationale: reason }, { onSuccess: () => toast({ title: "Site policy saved; inspection status recalculated" }), onError: (e: Error) => toast({ title: "Could not save site policy", description: e.message, variant: "destructive" }) })}>Save site policy</Button>}
    </fieldset>}
  </CardContent></Card>;
}

function DrillRotation({ facilityId }: { facilityId: string }) {
  const [from, setFrom] = useState(() => addFacilityCalendarDays(facilityToday(), -365));
  const query = useSiteDrillRotation(facilityId, from);
  const rotation = drillWeekdayRotation(query.data ?? []);
  return <Card><CardHeader><CardTitle>Drill day-of-week rotation</CardTitle></CardHeader><CardContent className="space-y-3"><Field label="Review drills since" type="date" value={from} change={setFrom} />{query.isError ? <QueryError what="drill rotation" error={query.error} onRetry={() => void query.refetch()} /> : <><div className="flex flex-wrap gap-3 text-sm">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => <span key={day}>{day}: {rotation.counts[i]}</span>)}</div>{rotation.latestRepeatedWeekday && <p className="text-sm text-amber-700">The two latest drills used the same weekday. Plan a different day, time and exit route.</p>}<p className="text-sm text-muted-foreground">§132 requires varying days, times and routes. This view helps plan rotation; the selected history window is not a separate statutory quota.</p>{query.data?.some((row) => row.evacuation_time_exceeded) && <p className="text-sm text-destructive">Evacuation-time violations exist in this history. Later successful drills do not erase them.</p>}</>}</CardContent></Card>;
}

function ReviewDialog({ previous, onClose, onSaved, ...props }: Props & { previous: FacilitySiteReview | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const mutation = useAddFacilitySiteReview();
  const [type, setType] = useState<SiteReviewType>((previous?.review_type as SiteReviewType) ?? "bedside_device");
  const [event, setEvent] = useState(previous?.event_kind ?? "review");
  const [item, setItem] = useState(previous?.inspection_item_id ?? "");
  const [vehicle, setVehicle] = useState(previous?.vehicle_id ?? "");
  const [employee, setEmployee] = useState(previous?.employee_id ?? "");
  const [external, setExternal] = useState(previous?.external_driver_name ?? "");
  const [resident, setResident] = useState(previous?.resident_id ?? "");
  const [plan, setPlan] = useState(previous?.support_plan_id ?? "");
  const [agreement, setAgreement] = useState(previous?.agreement_version_id ?? "");
  const [occurred, setOccurred] = useState(() => previous ? toFacilityDateTimeLocal(previous.occurred_at) : "");
  const [next, setNext] = useState(previous?.next_review_on ?? "");
  const [evidence, setEvidence] = useState("");
  const [details, setDetails] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries((previous?.details ?? {}) as Record<string, string>).map(([key, value]) => [key, key.endsWith("_at") && value ? toFacilityDateTimeLocal(value) : String(value)])));
  const set = (key: string, value: string) => setDetails((d) => ({ ...d, [key]: value }));
  const items = useListInspectionItems({ facilityId: props.facilityId }, { enabled: !!props.facilityId });
  const vehicles = useFacilityTransportVehicles(props.facilityId);
  const residents = useListResidents({ facilityId: props.facilityId }, { enabled: !!props.facilityId });
  const employees = useListEmployees({ facilityId: props.facilityId }, { enabled: !!props.facilityId });
  const plans = useSiteSupportPlans(resident);
  const agreements = useResidentAgreements(resident || undefined);
  const documents = useListDocuments({ facilityId: props.facilityId });
  const upload = useUploadDocument();
  const signedUrl = useDocumentSignedUrl();
  const docOptions = (documents.data ?? []).filter((doc) => doc.employee_id === (type === "driver_license" ? employee || null : null)).map((doc) => ({ id: doc.id, label: doc.file_name }));
  const chooseDoc = (key: string, label: string) => <div className="space-y-1" key={key}><Choice label={label} value={details[key] ?? ""} change={(v) => set(key, v)} options={docOptions} />{details[key] && <Button size="sm" variant="ghost" onClick={() => { const doc = documents.data?.find((d) => d.id === details[key]); if (doc) signedUrl.mutate(doc, { onSuccess: (url) => openDocumentUrl(url), onError: (e: Error) => toast({ title: "Could not open evidence", description: e.message, variant: "destructive" }) }); }}>Open copy</Button>}</div>;
  const detailField = (key: string, label: string, inputType?: string) => <Field key={key} label={label} type={inputType} value={details[key] ?? ""} change={(v) => set(key, v)} />;
  const submit = () => {
    if (!occurred || evidence.trim().length < 5) return;
    const converted = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, key.endsWith("_at") && value ? facilityDateTimeLocalToUtcIso(value) : value]));
    mutation.mutate({ organization_id: props.organizationId, facility_id: props.facilityId, review_type: type, event_kind: event,
      inspection_item_id: ["bedside_device", "voice_device", "fire_approval"].includes(type) ? item || null : null, vehicle_id: type === "vehicle_documents" ? vehicle || null : null,
      resident_id: ["bedside_device", "voice_device"].includes(type) ? resident || null : null, employee_id: type === "driver_license" ? employee || null : null, external_driver_name: type === "driver_license" && !employee ? external.trim() || null : null,
      support_plan_id: type === "bedside_device" ? plan || null : null, agreement_version_id: type === "voice_device" ? agreement || null : null, supersedes_id: previous?.id ?? null,
      occurred_at: facilityDateTimeLocalToUtcIso(occurred), next_review_on: next || null, details: converted, evidence: evidence.trim(),
    }, { onSuccess: onSaved, onError: (e: Error) => toast({ title: "Could not record review", description: e.message, variant: "destructive" }) });
  };
  const lookupError = items.error ?? vehicles.error ?? residents.error ?? employees.error ?? plans.error ?? agreements.error ?? documents.error;
  return <Dialog open onOpenChange={(value) => !value && onClose()}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{previous ? "Append site follow-up / correction" : "Record site review"}</DialogTitle></DialogHeader><div className="space-y-3">
    {lookupError && <p role="alert" className="text-sm text-destructive">Evidence choices could not load: {String(lookupError.message)}</p>}
    <Choice label="Review type" value={type} disabled={!!previous} change={(v) => { setType(v as SiteReviewType); setEvent("review"); setDetails({}); setItem(""); setNext(""); }} options={Object.entries(SITE_REVIEW_LABELS).map(([id, label]) => ({ id, label }))} />
    {["bedside_device", "voice_device", "fire_approval"].includes(type) && <Choice label="Device / fire approval item" value={item} disabled={!!previous} change={setItem} options={(items.data ?? []).filter((i) => i.item_type === ({ bedside_device: "bedside_mobility_device", voice_device: "voice_controlled_device_policy", fire_approval: "fire_safety_approval" } as Record<string, string>)[type]).map((i) => ({ id: i.id, label: i.label }))} />}
    {type === "vehicle_documents" && <Choice label="Facility vehicle" value={vehicle} disabled={!!previous} change={setVehicle} options={(vehicles.data ?? []).map((v) => ({ id: v.id, label: `${v.label} · ${humanize(v.status)}` }))} />}
    {["bedside_device", "voice_device"].includes(type) && <Choice label="Resident (required for resident-owned devices)" value={resident} disabled={!!previous} change={(v) => { setResident(v); setPlan(""); setAgreement(""); }} options={(residents.data ?? []).map((r) => ({ id: r.id, label: `${r.last_name}, ${r.first_name}` }))} />}
    {type === "driver_license" && <><Choice label="Employee driver (or leave empty for external driver)" value={employee} disabled={!!previous} change={setEmployee} options={(employees.data ?? []).map((e) => ({ id: e.id, label: `${e.last_name}, ${e.first_name}` }))} />{!employee && <Field label="External driver's full name (exactly as trip assignment)" value={external} change={setExternal} type="text" />}</>}
    <Choice label="Event" value={event} change={setEvent} options={(type === "fire_approval" ? ["review", "withdrawn", "restricted", "renovation", "use_changed", "renewed"] : ["bedside_device", "voice_device"].includes(type) ? ["review", "removed"] : ["review"]).map((id) => ({ id, label: humanize(id) }))} />
    <Field label="Actual event time (Pennsylvania)" type="datetime-local" value={occurred} change={setOccurred} />
    {event === "removed" ? detailField("removal_reason", "Reason for immediate removal and action taken") : <>
      {type === "bedside_device" && <><Choice label="Approved / effective support plan" value={plan} change={setPlan} options={(plans.data ?? []).map((p) => ({ id: p.id, label: `Version ${p.version_number} · ${p.effective_date ?? "no date"} · ${p.state}` }))} />{Object.entries(BEDSIDE_FIELDS).filter(([key]) => key !== "alf_203" || props.facilityType === "ALR").map(([key, label]) => detailField(key, label))}<label className="flex gap-2 text-sm"><input type="checkbox" checked={details.appropriate === "true"} onChange={(e) => set("appropriate", String(e.target.checked))} />Device remains appropriate; otherwise record its immediate removal.</label></>}
      {type === "voice_device" && <><Choice label="Device ownership" value={details.ownership ?? ""} change={(v) => set("ownership", v)} options={[{ id: "resident", label: "Resident" }, { id: "facility", label: "Facility" }]} />{resident && <Choice label="Executed contract / device agreement version" value={agreement} change={setAgreement} options={(agreements.data?.versions ?? []).filter((v) => v.status === "active" && agreements.data?.agreements.some((a) => a.id === v.agreement_id && a.status === "executed")).map((v) => ({ id: v.id, label: v.version_label }))} />}{Object.entries(VOICE_FIELDS).filter(([key]) => details.ownership === "facility" || !["administrators", "posted_notice", "history_deletion", "disclosure_policy"].includes(key)).map(([key, label]) => detailField(key, label))}</>}
      {["vehicle_documents", "driver_license"].includes(type) && <>{type === "driver_license" && <><label className="flex gap-2 text-sm"><input type="checkbox" checked={details.cdl_required === "true"} onChange={(e) => set("cdl_required", String(e.target.checked))} />Commercial driver's license required</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={details.adult_driver_verified === "true"} onChange={(e) => set("adult_driver_verified", String(e.target.checked))} />Verified driver is at least 18 years old</label></>}{(type === "vehicle_documents" ? ["registration", "insurance", "inspection"] : details.cdl_required === "true" ? ["license", "cdl"] : ["license"]).map((key) => <div key={key} className="rounded border p-3 space-y-2">{chooseDoc(`${key}_document_id`, `${humanize(key)} copy`)}{detailField(`${key}_expires_on`, `${humanize(key)} expiration`, "date")}</div>)}</>}
      {type === "fire_approval" && <>{chooseDoc("approval_document_id", "Approval / written authority certification copy")}{props.facilityType === "ALR" && ["review", "renewed", "use_changed"].includes(event) && detailField("approval_issued_on", "Actual approval issue date (from document)", "date")}{props.facilityType === "ALR" && <label className="flex gap-2 text-sm"><input type="checkbox" checked={details.changed_use_within_three_years === "true"} onChange={(e) => set("changed_use_within_three_years", String(e.target.checked))} />Building use changed within the past three years</label>}{["withdrawn", "restricted"].includes(event) && ["oral_notified_at", "written_notified_at"].map((key) => <div key={key} className="rounded border p-3 space-y-2">{detailField(key, key.startsWith("oral") ? "Actual immediate oral DHS notice" : "Actual written DHS notice (48-hour deadline)", "datetime-local")}{detailField(`${key}_evidence`, "Recipient and delivery evidence")}</div>)}{event === "renovation" && <>{detailField("submitted_at", "Actual DHS submission of new approval or authority certification (15-day deadline)", "datetime-local")}{detailField("submitted_at_evidence", "Submission recipient and evidence")}</>}</>}
      {["bedside_device", "voice_device", "fire_approval"].includes(type) && <Field label="Next review / renewal date (facility procedure or earlier DHS request)" type="date" value={next} change={setNext} />}
      {["vehicle_documents", "driver_license", "fire_approval"].includes(type) && <label className="block space-y-1 text-sm"><span>Upload a document copy, then select it above</span><Input type="file" disabled={upload.isPending} onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate({ file, bucket: "external-uploads", organizationId: props.organizationId, facilityId: props.facilityId, employeeId: type === "driver_license" ? employee || undefined : undefined, documentType: "other" }, { onSuccess: () => toast({ title: "Document uploaded; choose it for the relevant field" }), onError: (error: Error) => toast({ title: "Upload failed", description: error.message, variant: "destructive" }) }); }} /></label>}
    </>}
    <Field label="Reviewer, findings, decision and evidence / correction reason" value={evidence} change={setEvidence} />
    <Button disabled={mutation.isPending || upload.isPending || !!lookupError || !occurred || evidence.trim().length < 5} onClick={submit}>Record review</Button>
  </div></DialogContent></Dialog>;
}





