import { useId, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap, RefreshCw, Settings2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListResidents } from "@/hooks/useResidents";
import { useResidentNavigationContext } from "@/hooks/useResidentNavigationContext";
import {
  type MedicationException,
  type MedicationIngestionActivity,
  type MedicationIntegrationWorkspace,
  type MedicationSource,
  useAssignMedicationIntegrationException,
  useMedicationIntegration,
  useResidentExternalMedications,
  useResolveMedicationIntegrationException,
  useSaveMedicationIntegrationSource,
  useMapMedicationResident,
} from "@/hooks/useMedicationIntegration";
import { useListProfiles } from "@/hooks/useProfiles";
import {
  credentialIsExpired,
  credentialSupportsMedicationWrite,
  useOrganizationIntegrationCredentials,
} from "@/hooks/useIntegrationCredentials";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { toFacilityDateTimeLocal, facilityDateTimeLocalToUtcIso, addFacilityCalendarDays, facilityToday} from "@/lib/dateUtils";
import { Link } from "wouter";

function human(value: string) {
  return value.replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function sourceFreshness(source: MedicationSource) {
  if (!source.last_sync_completed_at) return { label: "Never synchronized", stale: true };
  const ageMinutes = (Date.now() - new Date(source.last_sync_completed_at).getTime()) / 60_000;
  return { label: `${Math.max(0, Math.floor(ageMinutes))} minutes ago`, stale: ageMinutes > source.freshness_threshold_minutes };
}

/**
 * The facility-wide view of an integration console: what arrived, for whom, and how recently.
 *
 * This page used to render medication names, directions and schedules for every resident in the
 * building here. That is chart content on a page whose question is whether the feed is working,
 * and there is no honest way to log it -- it is not a read of any one resident's record. Choosing a
 * resident above shows their orders and administrations through a reader that does log the access.
 */
function MedicationActivityView(
  { activity, residentNames }: { activity: MedicationIngestionActivity; residentNames: Map<string, string> },
) {
  return (
    <div className="space-y-3">
      <Alert>
        <DatabaseZap className="h-4 w-4" />
        <AlertTitle>What arrived, not what it says</AlertTitle>
        <AlertDescription>
          Medication names, directions and schedules are clinical record content. Pick a resident to
          read theirs; the access is recorded against your name.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardHeader className="pb-2">
          <CardDescription>External orders ingested</CardDescription>
          <CardTitle className="text-2xl">{activity.orderTotal}</CardTitle>
        </CardHeader><CardContent className="pt-0 text-sm text-muted-foreground">
          {activity.lastOrderAt ? `Most recent ${new Date(activity.lastOrderAt).toLocaleString()}` : "Nothing received yet"}
        </CardContent></Card>
        <Card><CardHeader className="pb-2">
          <CardDescription>Administrations ingested</CardDescription>
          <CardTitle className="text-2xl">{activity.administrationTotal}</CardTitle>
        </CardHeader><CardContent className="pt-0 text-sm text-muted-foreground">
          {activity.lastAdministrationAt ? `Most recent ${new Date(activity.lastAdministrationAt).toLocaleString()}` : "Nothing received yet"}
        </CardContent></Card>
      </div>
      {activity.residents.length === 0 ? (
        <Card><CardContent className="py-10 text-center">
          <DatabaseZap className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
          <p className="font-medium">No records ingested for this facility</p>
          <p className="text-sm text-muted-foreground">Match at least one resident, then check the source&rsquo;s last sync above.</p>
        </CardContent></Card>
      ) : activity.residents.map((row) => (
        <Card key={row.resident_id}><CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div>
            <p className="font-medium">{residentNames.get(row.resident_id) ?? "Scoped resident"}</p>
            <p className="text-sm text-muted-foreground">
              {row.order_count} {row.order_count === 1 ? "order" : "orders"} · {row.active_order_count} active · {row.administration_count} {row.administration_count === 1 ? "administration" : "administrations"}
              {row.non_routine_count > 0 ? ` · ${row.non_routine_count} non-routine` : ""}
            </p>
            {row.last_activity_at && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />Last record {new Date(row.last_activity_at).toLocaleString()}
              </p>
            )}
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/app/residents/${row.resident_id}/chart`}>Open chart</Link>
          </Button>
        </CardContent></Card>
      ))}
    </div>
  );
}

export default function MedicationIntegration() {
  const __fieldIds = useId();
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  // A platform admin has no organizationId of their own, so keying off it alone left the facility
  // list, the profile list and the credential list permanently empty -- the same defect
  // FhirIntegration.tsx carries a note about, uncorrected here until now.
  const scopeOrgId = viewingOrgId ?? user?.organizationId ?? undefined;
  const facilities = useListFacilities({ organizationId: scopeOrgId });
  const residentContext = useResidentNavigationContext();
  const [selectedFacilityId, setSelectedFacilityId] = useState("");
  // A selection made before the header's "Viewing as" organization changed is not a facility of the
  // organization now in scope, and it took precedence over the refreshed list -- so the workspace
  // and resident queries stayed on the previous tenant while the header, profiles and credentials
  // all moved to the new one. Ignore any selection absent from the current list rather than
  // trusting local state to have been reset; while the list is loading nothing is in scope, which
  // gates the queries off instead of running them against a stale facility.
  const scopedFacilities = facilities.data ?? [];
  const selectionInScope = scopedFacilities.some((facility) => facility.id === selectedFacilityId);
  const facilityId = (selectionInScope ? selectedFacilityId : "")
    || residentContext.facilityId || scopedFacilities[0]?.id || "";
  const selectedFacilityOrgId = useMemo(
    () => (facilities.data ?? []).find((facility) => facility.id === facilityId)?.organization_id ?? null,
    [facilities.data, facilityId],
  );
  const workspace = useMedicationIntegration(facilityId || undefined);
  // Content only when a resident is chosen, and then through the reader that logs the access.
  const residentMedications = useResidentExternalMedications(
    residentContext.residentId || undefined,
    "eMAR integration review",
  );
  // Gated on the facility being known. `useListResidents` applies its facility filter only `if`
  // truthy, so before the picker resolves an ungated read pulls every resident name and room
  // number in the organization into the browser to build a lookup map that is then thrown away.
  const residents = useListResidents(
    { facilityId: facilityId || undefined },
    { enabled: Boolean(facilityId) },
  );
  const residentNames = useMemo(() => new Map((residents.data ?? []).map((resident) => [resident.id, `${resident.last_name}, ${resident.first_name}${resident.room ? ` · Room ${resident.room}` : ""}`])), [residents.data]);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [externalFacilityId, setExternalFacilityId] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [freshnessMinutes, setFreshnessMinutes] = useState("60");
  const saveSource = useSaveMedicationIntegrationSource();
  const [selectedException, setSelectedException] = useState<MedicationException | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<"acknowledged" | "resolved" | "dismissed">("acknowledged");
  const [resolutionNote, setResolutionNote] = useState("");
  const resolveException = useResolveMedicationIntegrationException();
  const mapResident = useMapMedicationResident();
  const [mappingResidentId, setMappingResidentId] = useState("");
  const assignException = useAssignMedicationIntegrationException();
  const profiles = useListProfiles({ organizationId: selectedFacilityOrgId ?? scopeOrgId });
  // Credentials belong to whichever organization owns the facility being configured, which for a
  // platform admin is not necessarily the viewing org.
  const credentials = useOrganizationIntegrationCredentials(selectedFacilityOrgId ?? scopeOrgId);
  const medicationCredentials = useMemo(
    () => (credentials.data ?? []).filter((credential) => credentialSupportsMedicationWrite(credential) && !credentialIsExpired(credential)),
    [credentials.data],
  );
  const [exceptionOwnerId, setExceptionOwnerId] = useState("");
  const [exceptionDueAt, setExceptionDueAt] = useState(() => `${addFacilityCalendarDays(facilityToday(), 1)}T09:00`);
  const { toast } = useToast();

  const unboundCredentialValue = "__unbound__";

  const data: MedicationIntegrationWorkspace = workspace.data ?? {
    sources: [],
    exceptions: [],
    activity: {
      orderTotal: 0, orderActiveTotal: 0, administrationTotal: 0, nonRoutineTotal: 0,
      lastOrderAt: null, lastAdministrationAt: null, residents: [],
    },
  };
  const displayedOrders = residentMedications.data?.orders ?? [];
  const displayedAdministrations = residentMedications.data?.administrations ?? [];
  const openExceptions = data.exceptions.filter((item) => !["resolved", "dismissed"].includes(item.status));
  const activeOrderCount = residentContext.residentId
    ? displayedOrders.filter((item) => item.order_status === "active").length
    : data.activity.orderActiveTotal;
  const nonRoutineCount = residentContext.residentId
    ? displayedAdministrations.filter((item) => item.administration_status !== "administered").length
    : data.activity.nonRoutineTotal;

  const submitSource = async () => {
    if (!facilityId) return;
    try {
      await saveSource.mutateAsync({
        facilityId,
        name: sourceName.trim(),
        vendorName: vendorName.trim(),
        externalFacilityId: externalFacilityId.trim(),
        credentialId: credentialId.trim() || undefined,
        freshnessThresholdMinutes: Number(freshnessMinutes),
        status: credentialId.trim() ? "active" : "setup_required",
      });
      setSourceDialogOpen(false);
      setSourceName(""); setVendorName(""); setExternalFacilityId(""); setCredentialId(""); setFreshnessMinutes("60");
      toast({ title: "Medication integration source saved" });
    } catch (error) {
      toast({ title: "Source could not be saved", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const submitResolution = async () => {
    if (!selectedException || resolutionNote.trim().length < 5) return;
    try {
      await resolveException.mutateAsync({ exceptionId: selectedException.id, facilityId, status: resolutionStatus, note: resolutionNote.trim() });
      setSelectedException(null); setResolutionNote("");
      toast({ title: "Integration exception updated" });
    } catch (error) {
      toast({ title: "Exception could not be updated", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const submitAssignment = async () => {
    if (!selectedException || !exceptionOwnerId || !exceptionDueAt) return;
    try {
      await assignException.mutateAsync({ exceptionId: selectedException.id, facilityId, ownerProfileId: exceptionOwnerId, dueAt: facilityDateTimeLocalToUtcIso(exceptionDueAt), serviceLevelMinutes: 1440 });
      toast({ title: "Exception assigned with a linked work item" });
      setSelectedException(null); setExceptionOwnerId(""); setExceptionDueAt(`${addFacilityCalendarDays(facilityToday(), 1)}T09:00`);
    } catch (error) {
      toast({ title: "Exception could not be assigned", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Medication Integration</h1><p className="text-muted-foreground">Monitor read-only eMAR synchronization, resident matching, and non-routine administration documentation.</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => void workspace.refetch()} disabled={workspace.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${workspace.isFetching ? "animate-spin" : ""}`} />Refresh</Button>{canManage && <Button onClick={() => { setSourceName(""); setVendorName(""); setExternalFacilityId(""); setCredentialId(""); setFreshnessMinutes("60"); setSourceDialogOpen(true); }}><Settings2 className="mr-2 h-4 w-4" />Configure source</Button>}</div>
      </div>

      <Alert><DatabaseZap className="h-4 w-4" /><AlertTitle>External clinical source of truth</AlertTitle><AlertDescription>CareBase displays normalized records received from a connected eMAR. Medication orders and administrations cannot be prescribed, changed, or back-entered here. Confirm clinical details and correct discrepancies in the source eMAR.</AlertDescription></Alert>

      <Card><CardContent className="p-4"><div className="max-w-sm space-y-2"><Label htmlFor={`${__fieldIds}-facility`}>Facility</Label><Select value={facilityId} onValueChange={(value) => { setSelectedFacilityId(value); residentContext.setFacilityId(value); }}><SelectTrigger id={`${__fieldIds}-facility`}><SelectValue placeholder="Select facility" /></SelectTrigger><SelectContent>{facilities.data?.map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select>{residentContext.residentId && <p className="text-xs text-muted-foreground">Showing medication documentation for {residentNames.get(residentContext.residentId) ?? "the selected resident"}. Change facility to clear this resident filter.</p>}</div></CardContent></Card>

      {workspace.isError ? <QueryError what="medication integration" error={workspace.error} onRetry={() => workspace.refetch()} /> : workspace.isLoading ? <QueryLoading what="medication integration" /> : (
        <>
          <div className="grid gap-4 md:grid-cols-3"><Card><CardHeader className="pb-2"><CardDescription>Open sync exceptions</CardDescription><CardTitle className="text-3xl">{openExceptions.length}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Active external orders</CardDescription><CardTitle className="text-3xl">{activeOrderCount}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Non-routine administrations</CardDescription><CardTitle className="text-3xl">{nonRoutineCount}</CardTitle></CardHeader></Card></div>

          <div className="grid gap-4 lg:grid-cols-2">{data.sources.length === 0 ? <Card className="lg:col-span-2"><CardContent className="py-10 text-center"><DatabaseZap className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No eMAR source configured</p><p className="text-sm text-muted-foreground">{canManage ? "Create a source, then bind it to an integration credential carrying the medications:write scope." : "A facility administrator must configure an eMAR source."}</p></CardContent></Card> : data.sources.map((source) => { const freshness = sourceFreshness(source); return <Card key={source.id} className={freshness.stale || source.status === "error" ? "border-destructive/60" : ""}><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{source.name}</CardTitle><CardDescription>{source.vendor_name} · External facility {source.external_facility_id}</CardDescription></div><Badge variant={source.status === "active" ? "outline" : source.status === "error" ? "destructive" : "secondary"}>{human(source.status)}</Badge></div></CardHeader><CardContent className="space-y-2 text-sm"><p className="flex items-center gap-2">{freshness.stale ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}Last complete sync: {freshness.label}</p><p className="text-muted-foreground">Freshness target: {source.freshness_threshold_minutes} minutes</p>{source.last_error_message && <p className="text-destructive">{source.last_error_message}</p>}{!source.credential_id && <p className="text-amber-700">Setup required: bind a medications:write integration credential.</p>}</CardContent></Card>; })}</div>

          <Tabs defaultValue="exceptions"><TabsList><TabsTrigger value="exceptions">Exceptions ({openExceptions.length})</TabsTrigger><TabsTrigger value="orders">External orders</TabsTrigger><TabsTrigger value="administrations">Administration documentation</TabsTrigger></TabsList>
            <TabsContent value="exceptions" className="space-y-3">{data.exceptions.length === 0 ? <Card><CardContent className="py-10 text-center"><CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-emerald-600" /><p>No integration exceptions recorded.</p></CardContent></Card> : data.exceptions.map((item) => <Card key={item.id}><CardContent className="flex flex-wrap items-start justify-between gap-4 p-4"><div><div className="mb-1 flex flex-wrap gap-2"><Badge variant={item.severity === "urgent" ? "destructive" : "outline"}>{human(item.severity)}</Badge><Badge variant="secondary">{human(item.status)}</Badge></div><p className="font-medium">{human(item.exception_type)}</p><p className="text-sm text-muted-foreground">{item.summary}</p>{item.external_resident_id && <p className="mt-1 text-xs text-muted-foreground">External resident ID: {item.external_resident_id}</p>}</div>{canManage && !["resolved", "dismissed"].includes(item.status) && <Button size="sm" variant="outline" onClick={() => { setSelectedException(item); setResolutionStatus("acknowledged"); setResolutionNote(""); setMappingResidentId(""); setExceptionOwnerId(""); setExceptionDueAt(`${addFacilityCalendarDays(facilityToday(), 1)}T09:00`); }}>Review</Button>}</CardContent></Card>)}</TabsContent>
            <TabsContent value="orders" className="space-y-3">
              {!residentContext.residentId ? (
                <MedicationActivityView activity={data.activity} residentNames={residentNames} />
              ) : residentMedications.isLoading ? (
                <QueryLoading what="external orders" />
              ) : residentMedications.isError ? (
                <QueryError what="external orders" error={residentMedications.error} onRetry={() => void residentMedications.refetch()} />
              ) : displayedOrders.length === 0 ? (
                <Card><CardContent className="py-10 text-center"><p className="text-sm text-muted-foreground">No external orders on file for this resident.</p></CardContent></Card>
              ) : displayedOrders.map((order) => <Card key={order.id}><CardContent className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{order.medication_display}</p><p className="text-sm text-muted-foreground">{residentNames.get(order.resident_id) ?? "Scoped resident"}</p>{order.directions && <p className="mt-2 text-sm">{order.directions}</p>}{order.schedule_display && <p className="text-sm text-muted-foreground">{order.schedule_display}</p>}</div><Badge variant="outline">{human(order.order_status)}</Badge></div><p className="mt-2 text-xs text-muted-foreground">Source updated {new Date(order.source_updated_at).toLocaleString()}</p></CardContent></Card>)}
            </TabsContent>
            <TabsContent value="administrations" className="space-y-3">
              {!residentContext.residentId ? (
                <MedicationActivityView activity={data.activity} residentNames={residentNames} />
              ) : residentMedications.isLoading ? (
                <QueryLoading what="administration documentation" />
              ) : residentMedications.isError ? (
                <QueryError what="administration documentation" error={residentMedications.error} onRetry={() => void residentMedications.refetch()} />
              ) : displayedAdministrations.length === 0 ? (
                <Card><CardContent className="py-10 text-center"><p className="text-sm text-muted-foreground">No administration documentation on file for this resident.</p></CardContent></Card>
              ) : displayedAdministrations.map((event) => <Card key={event.id}><CardContent className="flex flex-wrap items-start justify-between gap-3 p-4"><div><p className="font-medium">{residentNames.get(event.resident_id) ?? "Scoped resident"}</p><p className="flex items-center gap-1 text-sm text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{new Date(event.occurred_at).toLocaleString()}</p>{event.source_note && <p className="mt-2 text-sm">{event.source_note}</p>}</div><Badge variant={event.administration_status === "administered" ? "outline" : "destructive"}>{human(event.administration_status)}</Badge></CardContent></Card>)}
            </TabsContent>
          </Tabs>
        </>
      )}

      <Dialog open={sourceDialogOpen} onOpenChange={setSourceDialogOpen}><DialogContent><DialogHeader><DialogTitle>Configure medication source</DialogTitle><DialogDescription>Pick an organization credential that includes medications:write (or commands:write). Leave it unbound to save a setup-required source.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="med-source-name">Connection name</Label><Input id="med-source-name" value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="Main campus eMAR" /></div><div className="space-y-2"><Label htmlFor="med-vendor">Vendor</Label><Input id="med-vendor" value={vendorName} onChange={(event) => setVendorName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="med-external-facility">External facility ID</Label><Input id="med-external-facility" value={externalFacilityId} onChange={(event) => setExternalFacilityId(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="med-freshness">Freshness target (minutes)</Label><Input id="med-freshness" type="number" min="5" max="1440" value={freshnessMinutes} onChange={(event) => setFreshnessMinutes(event.target.value)} /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor={`${__fieldIds}-integration-credential`}>Integration credential</Label><Select value={credentialId || unboundCredentialValue} onValueChange={(value) => setCredentialId(value === unboundCredentialValue ? "" : value)}><SelectTrigger id={`${__fieldIds}-integration-credential`} aria-label="Integration credential"><SelectValue placeholder="Select a credential" /></SelectTrigger><SelectContent><SelectItem value={unboundCredentialValue}>Leave unbound (setup required)</SelectItem>{medicationCredentials.map((credential) => <SelectItem key={credential.id} value={credential.id}>{credential.name} · {credential.key_prefix}… · {credential.scopes.join(", ")}</SelectItem>)}</SelectContent></Select>{credentials.isError ? <p className="text-xs text-destructive">Credentials could not be loaded. Try again or ask an organization administrator.</p> : credentials.isLoading ? <p className="text-xs text-muted-foreground">Loading credentials…</p> : medicationCredentials.length === 0 ? <p className="text-xs text-muted-foreground">No active medications:write credentials in this organization. An organization administrator can issue one from the <Link href="/app/value-center" className="underline">Value Center</Link>.</p> : null}</div></div><DialogFooter><Button variant="outline" onClick={() => setSourceDialogOpen(false)}>Cancel</Button><Button disabled={saveSource.isPending || sourceName.trim().length < 2 || vendorName.trim().length < 2 || externalFacilityId.trim().length < 1} onClick={() => void submitSource()}>{saveSource.isPending ? "Saving…" : "Save source"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!selectedException} onOpenChange={(open) => !open && setSelectedException(null)}>
        <DialogContent><DialogHeader><DialogTitle>Review medication integration exception</DialogTitle><DialogDescription>Assign an accountable owner and SLA-backed work item, or record the operational disposition. Clinical correction remains in the external eMAR.</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${__fieldIds}-owner`}>Owner</Label><Select value={exceptionOwnerId} onValueChange={setExceptionOwnerId}><SelectTrigger id={`${__fieldIds}-owner`}><SelectValue placeholder="Assign owner" /></SelectTrigger><SelectContent>{(profiles.data ?? []).filter((profile) => profile.is_active && ["org_admin", "facility_manager"].includes(profile.role)).map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="med-exception-due">Due by</Label><Input id="med-exception-due" type="datetime-local" value={exceptionDueAt} onChange={(event) => setExceptionDueAt(event.target.value)} /></div><div className="sm:col-span-2"><Button variant="outline" disabled={assignException.isPending || !exceptionOwnerId || !exceptionDueAt} onClick={() => void submitAssignment()}>{assignException.isPending ? "Assigning…" : "Assign and create work item"}</Button></div></div>
          {selectedException?.exception_type === "unmatched_resident" && selectedException.external_resident_id && (
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor={`${__fieldIds}-map-resident`}>Map to resident</Label>
              <p className="text-xs text-muted-foreground">
                The eMAR is sending administration data for external id{" "}
                <span className="font-mono">{selectedException.external_resident_id}</span>, which
                matches nobody here. Until it is mapped, that evidence never reaches a resident&apos;s
                chart — so acknowledging this exception does not fix it.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={mappingResidentId} onValueChange={setMappingResidentId}>
                  <SelectTrigger id={`${__fieldIds}-map-resident`} className="sm:w-80">
                    <SelectValue placeholder="Select the resident this refers to" />
                  </SelectTrigger>
                  <SelectContent>
                    {(residents.data ?? [])
                      .filter((resident) => resident.facility_id === facilityId)
                      .map((resident) => (
                        <SelectItem key={resident.id} value={resident.id}>
                          {resident.last_name}, {resident.first_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  disabled={!mappingResidentId || mapResident.isPending}
                  onClick={() => {
                    if (!selectedException?.external_resident_id || !selectedException.source_id) return;
                    mapResident.mutate({
                      sourceId: selectedException.source_id,
                      residentId: mappingResidentId,
                      externalResidentId: selectedException.external_resident_id,
                      facilityId,
                    }, {
                      onSuccess: () => {
                        toast({ title: "Resident mapped", description: "The exception is resolved and future administrations will reach this resident's chart." });
                        setSelectedException(null);
                      },
                      onError: (error: Error) => toast({ title: "Couldn't map the resident", description: error.message, variant: "destructive" }),
                    });
                  }}
                >
                  {mapResident.isPending ? "Mapping…" : "Map resident"}
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-4 border-t pt-4"><div className="space-y-2"><Label htmlFor={`${__fieldIds}-disposition`}>Disposition</Label><Select value={resolutionStatus} onValueChange={(value) => setResolutionStatus(value as typeof resolutionStatus)}><SelectTrigger id={`${__fieldIds}-disposition`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="acknowledged">Acknowledged / working</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="dismissed">Dismissed with reason</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="med-resolution-note">Resolution note</Label><Textarea id="med-resolution-note" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} /></div></div>
          <DialogFooter><Button variant="outline" onClick={() => setSelectedException(null)}>Cancel</Button><Button disabled={resolveException.isPending || resolutionNote.trim().length < 5} onClick={() => void submitResolution()}>{resolveException.isPending ? "Saving…" : "Save disposition"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
