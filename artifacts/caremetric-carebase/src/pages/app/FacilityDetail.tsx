import { useMemo, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Building2, MapPin, Phone, Users, BedDouble, BookOpen, BarChart3, Clock, XCircle, Pencil, Trash2, AlertTriangle, Flame, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { useGetFacility, useUpdateFacility, useDeleteFacility } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListResidents } from "@/hooks/useResidents";
import { useListTrainingRecords } from "@/hooks/useTrainingRecords";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListIncidents } from "@/hooks/useIncidents";
import { useListInspectionItems } from "@/hooks/useInspectionItems";
import { useListFacilityUnits } from "@/hooks/useFacilityUnits";
import { useListEmployeeSchedulePreferences } from "@/hooks/useEmployeeSchedulePreferences";
import { StatusBadge } from "@/components/ui/status-badge";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { FACILITY_TYPES, PCH_ALR_ONLY_FACILITY_TYPES, facilityTypeBadgeClass, facilityTypeLabel, type FacilityType } from "@/lib/facilityTypes";
import { FREQUENCY_OPTIONS, responsiblePartyOptions } from "@/lib/residentAssessmentFormSchema";
import { getComplianceFormLabel } from "@/lib/residentCompliance";
import { useListAdministratorProfiles, useListAdministratorCeEntriesByOrganization } from "@/hooks/useAdministratorProfiles";
import { buildBestAdministratorRulePack, summarizeAdministratorRulePack } from "@/lib/administratorRulePacks";
import { selectCurrentTrainingRecords } from "@/lib/currentTrainingRecords";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { buildSpecialCareComplianceSummary } from "@/lib/specialCareCompliance";
import { FacilityLicensingWorkspace } from "@/components/facilities/FacilityLicensingWorkspace";

interface FacilityFormData {
  name: string;
  facilityType: FacilityType;
  licenseNumber: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  administratorName: string;
  administratorEmail: string;
  isActive: boolean;
  defaultCareResponsibleParty: string;
  defaultCareFrequency: string;
}

const EMPTY_FORM: FacilityFormData = {
  name: "", facilityType: "PCH", licenseNumber: "", address: "", city: "",
  state: "PA", zip: "", phone: "", administratorName: "", administratorEmail: "",
  isActive: true, defaultCareResponsibleParty: "", defaultCareFrequency: "",
};

const RELEVANT_STATUSES = new Set(["compliant", "due_soon", "expired", "missing"]);

export default function FacilityDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  // This page is mounted under /admin, /app, and /trainer prefixes -- every internal
  // link/redirect must match whichever role-specific directory surface the viewer is under,
  // mirroring the pattern in EmployeeDetail.tsx.
  const basePath = user?.role === "platform_admin" ? "/admin/facilities"
    : user?.role === "trainer" ? "/trainer/facilities"
    : "/app/facilities";
  const employeeBasePath = user?.role === "platform_admin" ? "/admin/employees"
    : user?.role === "trainer" ? "/trainer/employees"
    : "/app/employees";
  // Incident *detail* rows do have an /admin/incidents/:id counterpart (Alerts deep links use it --
  // see IncidentDetail.tsx), unlike the list route the "View all" link below points at.
  const incidentsBasePath = user?.role === "platform_admin" ? "/admin/incidents" : "/app/incidents";

  const canManage = ["platform_admin", "org_admin"].includes(user?.role ?? "");
  // Matches incidents_select RLS -- trainer is excluded (the incident data itself is sensitive),
  // unlike the inspection-compliance card below, which every viewer of this page can see.
  const canViewIncidents = ["platform_admin", "org_admin", "facility_manager", "auditor"].includes(user?.role ?? "");
  // Matches RESIDENT_ROLES in App.tsx (the actual /app/residents* route gate) exactly -- unlike
  // canViewIncidents above, platform_admin is deliberately left out here since there's no
  // /admin/residents route for a "View all"/row link to land on.
  const canViewResidents = ["org_admin", "facility_manager", "auditor"].includes(user?.role ?? "");
  // Incidents/Inspections are only reachable via /app/incidents and /app/inspections -- there's no
  // /admin/incidents or /admin/inspections *list* route (only .../:id, for Alerts deep links), so a
  // platform_admin viewing this page via /admin/facilities/:id has nowhere for a "View all" link to go.
  const canLinkToOrgLists = user?.role !== "platform_admin";

  const { data: facility, isLoading: facLoading, isError: facError, error: facErr, refetch: refetchFacility } = useGetFacility(id);
  const { data: employees, isLoading: empLoading } = useListEmployees({ facilityId: id });
  const { data: residents, isLoading: residentsLoading } = useListResidents({ facilityId: id });
  const { data: trainingRecords, isLoading: recordsLoading } = useListTrainingRecords({ facilityId: id });
  const { data: trainingTypes } = useListTrainingTypes();
  const { data: practicums, isLoading: practicumsLoading } = useListPracticums({ facilityId: id });
  const { data: incidents, isLoading: incidentsLoading } = useListIncidents({ facilityId: id });
  const { data: inspectionItems, isLoading: inspectionsLoading } = useListInspectionItems({ facilityId: id, isActive: true });
  const { data: administratorProfiles, isLoading: administratorsLoading } = useListAdministratorProfiles(user?.organizationId ?? undefined);
  const { data: administratorCeEntries } = useListAdministratorCeEntriesByOrganization(user?.organizationId ?? undefined);
  const { data: units } = useListFacilityUnits({ facilityId: id });
  const { data: schedulePreferences } = useListEmployeeSchedulePreferences({ facilityId: id });

  const trainingTypeName = (typeId: string) => trainingTypes?.find(t => t.id === typeId)?.name ?? "Unknown requirement";
  // Renewal cycles insert fresh training rows and leave prior ones "expired"; the
  // facility compliance picture must only grade the current record per requirement.
  const currentTrainingRecords = useMemo(() => selectCurrentTrainingRecords(trainingRecords ?? []), [trainingRecords]);
  const relevantRecords = currentTrainingRecords.filter(r => RELEVANT_STATUSES.has(r.status));
  const compliantCount = relevantRecords.filter(r => r.status === "compliant").length;
  const compliancePct = relevantRecords.length > 0 ? Math.round((compliantCount / relevantRecords.length) * 100) : 100;
  const dueSoonRecords = currentTrainingRecords.filter(r => r.status === "due_soon");
  const expiredRecords = currentTrainingRecords.filter(r => r.status === "expired");
  const administratorEvaluation = useMemo(() => {
    if (!facility || !(facility.facility_type === "PCH" || facility.facility_type === "ALR")) return null;
    return buildBestAdministratorRulePack(facility.facility_type, {
      profiles: administratorProfiles ?? [],
      ceEntries: administratorCeEntries ?? [],
      today: toLocalIsoDate(),
    });
  }, [administratorProfiles, administratorCeEntries, facility]);
  const administratorRuleSummary = administratorEvaluation?.summary ?? summarizeAdministratorRulePack([]);
  const specialCareSummary = useMemo(() => buildSpecialCareComplianceSummary({
    units: units ?? [],
    residents: residents ?? [],
    schedulePreferences: schedulePreferences ?? [],
    trainingRecords: trainingRecords ?? [],
    trainingTypes: trainingTypes ?? [],
  }), [units, residents, schedulePreferences, trainingRecords, trainingTypes]);

  const { mutate: updateFacility, isPending: updating } = useUpdateFacility();
  const { mutate: deleteFacility, isPending: deleting } = useDeleteFacility();

  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [form, setForm] = useState<FacilityFormData>(EMPTY_FORM);

  const openEdit = () => {
    if (!facility) return;
    setForm({
      name: facility.name,
      facilityType: (facility.facility_type as FacilityType) ?? "PCH",
      licenseNumber: facility.license_number ?? "",
      address: facility.address ?? "",
      city: facility.city ?? "",
      state: facility.state ?? "PA",
      zip: facility.zip ?? "",
      phone: facility.phone ?? "",
      administratorName: facility.administrator_name ?? "",
      administratorEmail: facility.administrator_email ?? "",
      isActive: facility.is_active,
      defaultCareResponsibleParty: facility.default_care_responsible_party ?? "",
      defaultCareFrequency: facility.default_care_frequency ?? "",
    });
    setShowEdit(true);
  };

  const field = (k: keyof FacilityFormData, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!facility) return;
    if (!form.name.trim()) {
      toast({ title: "Facility name is required", variant: "destructive" });
      return;
    }
    updateFacility(
      {
        id: facility.id,
        name: form.name.trim(),
        facility_type: form.facilityType,
        license_number: form.licenseNumber || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        zip: form.zip || null,
        phone: form.phone || null,
        administrator_name: form.administratorName || null,
        administrator_email: form.administratorEmail || null,
        is_active: form.isActive,
        default_care_responsible_party: form.defaultCareResponsibleParty || null,
        default_care_frequency: form.defaultCareFrequency || null,
      },
      {
        onSuccess: () => { toast({ title: "Facility updated" }); setShowEdit(false); },
        onError: (e: Error) => toast({ title: "Failed to update facility", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleDelete = () => {
    if (!facility) return;
    deleteFacility(facility.id, {
      onSuccess: () => {
        toast({ title: "Facility deleted" });
        navigate(basePath);
      },
      onError: (e: Error) => toast({ title: "Failed to delete facility", description: e.message, variant: "destructive" }),
    });
  };

  if (facLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (facError) {
    return <QueryError what="this facility" error={facErr} onRetry={() => void refetchFacility()} />;
  }

  if (!facility) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Facility not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={basePath}>Back to Facilities</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={basePath}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{facility.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline" className={facilityTypeBadgeClass(facility.facility_type)}>{facilityTypeLabel(facility.facility_type)}</Badge>
              <Badge variant={facility.is_active ? "default" : "secondary"}>{facility.is_active ? "Active" : "Inactive"}</Badge>
              {facility.is_sandbox && <Badge className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-50" variant="outline">Training sandbox</Badge>}
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowDelete(true)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">License Number</p>
            <p className="font-semibold text-sm">{facility.license_number ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Location</p>
            <div className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="font-semibold text-sm">{[facility.city, facility.state].filter(Boolean).join(", ") || "—"}</p>
            </div>
            {facility.address && (
              <p className="text-xs text-muted-foreground mt-1">{facility.address}{facility.zip ? ` ${facility.zip}` : ""}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Phone</p>
            <div className="flex items-center gap-1">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="font-semibold text-sm">{facility.phone ?? "—"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Administrator</p>
            <p className="font-semibold text-sm">{facility.administrator_name ?? "—"}</p>
            {facility.administrator_email && <p className="text-xs text-muted-foreground truncate">{facility.administrator_email}</p>}
          </CardContent>
        </Card>
        {(PCH_ALR_ONLY_FACILITY_TYPES as readonly string[]).includes(facility.facility_type) && (
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Admin Rule Pack</p>
              {administratorsLoading ? (
                <Skeleton className="h-5 w-24 mt-1" />
              ) : (
                <>
                  <p className="font-semibold text-sm capitalize">{administratorRuleSummary.status.replaceAll("_", " ")}</p>
                  <p className="text-xs text-muted-foreground">{administratorRuleSummary.blockingCount} blocker(s), {administratorRuleSummary.dueSoonCount} due soon</p>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <FacilityLicensingWorkspace
        facilityId={facility.id}
        facilityType={facility.facility_type}
        canManage={["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "")}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PCH_ALR_ONLY_FACILITY_TYPES.includes(facility.facility_type as FacilityType) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BedDouble className="h-4 w-4 text-muted-foreground" /> Dementia / Special-Care Readiness
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-3xl font-bold">{specialCareSummary.staffingGapCount}</p>
                  <p className="text-xs text-muted-foreground">staff training gap(s) for designated units</p>
                </div>
                <Badge variant={specialCareSummary.status === "needs_attention" ? "destructive" : "outline"} className="capitalize">
                  {specialCareSummary.status.replaceAll("_", " ")}
                </Badge>
              </div>
              <div className="mt-3 text-xs text-muted-foreground space-y-1">
                <p>{specialCareSummary.designatedUnits.length} designated unit(s); {specialCareSummary.residentPlacements} resident placement(s)</p>
                <p>{specialCareSummary.trainedStaffCount} of {specialCareSummary.assignedStaffCount} assigned staff have current dementia/special-care training documentation.</p>
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-muted-foreground" /> Training Compliance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recordsLoading ? (
              <Skeleton className="h-16" />
            ) : relevantRecords.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No training requirements tracked for this facility yet.</p>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-3xl font-bold">{compliancePct}%</p>
                  <p className="text-xs text-muted-foreground">{compliantCount} of {relevantRecords.length} requirements compliant</p>
                </div>
                <div className="text-right text-xs text-muted-foreground space-y-0.5">
                  <p>{dueSoonRecords.length} due soon</p>
                  <p>{expiredRecords.length} expired</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-muted-foreground" /> Additional Requirements
            </CardTitle>
          </CardHeader>
          <CardContent>
            {practicumsLoading ? (
              <Skeleton className="h-16" />
            ) : !practicums?.length ? (
              <div className="text-center py-6 text-muted-foreground">
                <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No practicums tracked for this facility yet.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {["compliant", "due_soon", "expired", "missing"].map(status => {
                  const count = practicums.filter(p => p.status === status).length;
                  if (count === 0) return null;
                  return (
                    <div key={status} className="flex items-center justify-between text-sm">
                      <StatusBadge status={status} type="training" />
                      <span className="font-medium">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-muted-foreground" /> Upcoming Due Dates
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recordsLoading ? (
              <Skeleton className="h-16" />
            ) : !dueSoonRecords.length ? (
              <div className="text-center py-6 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nothing due soon for this facility.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {dueSoonRecords.slice(0, 5).map(r => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{trainingTypeName(r.training_type_id)}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{r.due_date}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <XCircle className="h-4 w-4 text-muted-foreground" /> Recently Expired
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recordsLoading ? (
              <Skeleton className="h-16" />
            ) : !expiredRecords.length ? (
              <div className="text-center py-6 text-muted-foreground">
                <XCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nothing expired for this facility.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {expiredRecords.slice(0, 5).map(r => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{trainingTypeName(r.training_type_id)}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{r.due_date}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {canViewIncidents && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" /> Open Incidents
              </CardTitle>
              {canLinkToOrgLists && (
                // Incidents.tsx reads this facility filter via useUrlState({ ..., facility: "all", ... }) --
                // the query param is named "facility", not "facilityId".
                <Link href={`${incidentsBasePath}?facility=${facility.id}`}>
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground -mr-2">
                    View All <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {incidentsLoading ? (
                <Skeleton className="h-16" />
              ) : (() => {
                const openIncidents = (incidents ?? []).filter(i => i.status !== "closed");
                return openIncidents.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No open incidents for this facility.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {openIncidents.slice(0, 5).map(i => (
                      <Link key={i.id} href={`${incidentsBasePath}/${i.id}`} className="flex items-center justify-between text-sm hover:underline">
                        <span className="truncate">{i.incident_type.replace(/_/g, " ")}</span>
                        <Badge
                          variant="outline"
                          className={
                            i.severity === "critical" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
                            : i.severity === "major" ? "bg-warning text-warning-foreground hover:bg-warning/80"
                            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                          }
                        >
                          {i.severity}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-muted-foreground" /> Inspection Compliance
            </CardTitle>
            {canLinkToOrgLists && (
              // Same useUrlState "facility" key as Incidents.tsx above -- see InspectionItems.tsx.
              <Link href={`/app/inspections?facility=${facility.id}`}>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground -mr-2">
                  View All <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {inspectionsLoading ? (
              <Skeleton className="h-16" />
            ) : !inspectionItems?.length ? (
              <div className="text-center py-6 text-muted-foreground">
                <Flame className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No inspection items tracked for this facility.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {["compliant", "due_soon", "expired", "missing"].map(status => {
                  const count = inspectionItems.filter(i => i.status === status).length;
                  if (count === 0) return null;
                  return (
                    <div key={status} className="flex items-center justify-between text-sm">
                      <StatusBadge status={status} type="training" />
                      <span className="font-medium">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Staff ({employees?.length ?? "..."})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {empLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !employees?.length ? (
            <p className="text-sm text-muted-foreground">No staff on record.</p>
          ) : (
            <div className="space-y-2">
              {employees.map(emp => (
                <Link key={emp.id} href={`${employeeBasePath}/${emp.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/5 cursor-pointer">
                    <div>
                      <p className="font-medium text-sm">{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs text-muted-foreground">{emp.job_title}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {emp.administers_medications && <Badge variant="outline" className="text-xs">Med Admin</Badge>}
                      {emp.trainer_status && <Badge variant="outline" className="text-xs">Trainer</Badge>}
                      <Badge variant={emp.status === "active" ? "default" : "secondary"} className="text-xs">{emp.status}</Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canViewResidents && (PCH_ALR_ONLY_FACILITY_TYPES as readonly string[]).includes(facility.facility_type) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BedDouble className="h-5 w-5" /> Residents ({residents?.length ?? "..."})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {residentsLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : !residents?.length ? (
              <p className="text-sm text-muted-foreground">No residents on record.</p>
            ) : (
              <div className="space-y-2">
                {residents.map(r => (
                  <Link key={r.id} href={`/app/residents/${r.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/5 cursor-pointer">
                      <div>
                        <p className="font-medium text-sm">{r.last_name}, {r.first_name}</p>
                        <p className="text-xs text-muted-foreground">{r.room ? `Room ${r.room}` : "No room on file"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {r.sdcu && <Badge variant="outline" className="text-xs">SDCU</Badge>}
                        {r.hospice && <Badge variant="outline" className="text-xs">Hospice</Badge>}
                        <Badge variant={r.status === "active" ? "default" : "secondary"} className="text-xs">{r.status}</Badge>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showEdit} onOpenChange={o => { if (!o) setShowEdit(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Facility</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Facility Name *</Label>
              <Input value={form.name} onChange={e => field("name", e.target.value)} placeholder="Sunrise Manor" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Type *</Label>
              <Select
                value={form.facilityType}
                // Resets defaultCareResponsibleParty -- its option list is type-specific (e.g. ASP-only
                // "SHCP"), so a value picked under the old type could be invalid for the new one.
                onValueChange={v => setForm(f => ({ ...f, facilityType: v as FacilityType, defaultCareResponsibleParty: "" }))}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FACILITY_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">License Number</Label>
              <Input value={form.licenseNumber} onChange={e => field("licenseNumber", e.target.value)} placeholder="LIC-0001" className="h-9" />
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Address</Label>
              <Input value={form.address} onChange={e => field("address", e.target.value)} placeholder="123 Main St" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">City</Label>
              <Input value={form.city} onChange={e => field("city", e.target.value)} placeholder="Philadelphia" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">State</Label>
              <Input value={form.state} onChange={e => field("state", e.target.value)} placeholder="PA" maxLength={2} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">ZIP</Label>
              <Input value={form.zip} onChange={e => field("zip", e.target.value)} placeholder="19103" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Phone</Label>
              <Input value={form.phone} onChange={e => field("phone", e.target.value)} placeholder="(215) 555-0100" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Administrator Name</Label>
              <Input value={form.administratorName} onChange={e => field("administratorName", e.target.value)} placeholder="Jane Smith" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Administrator Email</Label>
              <Input value={form.administratorEmail} onChange={e => field("administratorEmail", e.target.value)} placeholder="admin@facility.com" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Status</Label>
              <Select value={form.isActive ? "active" : "inactive"} onValueChange={v => field("isActive", v === "active")}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {PCH_ALR_ONLY_FACILITY_TYPES.includes(form.facilityType) && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Default Care Responsible Party</Label>
                  {/* "none" is a sentinel -- Radix SelectItem values can't be "", so a real "clear
                      this default" choice has to use a stand-in value and translate it back. */}
                  <Select
                    value={form.defaultCareResponsibleParty || "none"}
                    onValueChange={v => field("defaultCareResponsibleParty", v === "none" ? "" : v)}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {responsiblePartyOptions(getComplianceFormLabel(form.facilityType) === "ASP" ? "ASP" : "RASP").map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">Pre-fills every item on new RASP/ASP forms for this facility.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Default Care Frequency</Label>
                  <Select
                    value={form.defaultCareFrequency || "none"}
                    onValueChange={v => field("defaultCareFrequency", v === "none" ? "" : v)}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {FREQUENCY_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updating} className="shadow-sm">
              {updating ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Facility</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {facility.name}? This action cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
