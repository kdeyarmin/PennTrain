import { lazy, Suspense, useMemo, useState } from "react";
import { useParams, Link, useLocation, useSearch } from "wouter";
import { useGetResident } from "@/hooks/useResidents";
import { usePageTitle } from "@/lib/pageTitle";
import { useListResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
import { useListResidentDocuments } from "@/hooks/useResidentDocuments";
import { useListResidentInformalSupports } from "@/hooks/useResidentInformalSupports";
import { useListFacilities } from "@/hooks/useFacilities";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { EntityHistoryDrawer } from "@/components/EntityHistoryDrawer";
import { ArrowLeft, HeartPulse, Printer } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatDateOnly } from "@/lib/residentCompliance";
import { PCH_ALR_ONLY_FACILITY_TYPES } from "@/lib/facilityTypes";
import { ResidentFaceSheet } from "@/components/residents/ResidentFaceSheet";
import { ResidentCareHeaderPanel } from "@/components/residents/ResidentCareHeader";
import { ResidentNeedsAttentionPanel } from "@/components/residents/ResidentNeedsAttention";
import { useResidentCareHeader } from "@/hooks/useResidentCareHeader";
import { useResident360Snapshot } from "@/hooks/useResident360";
import { useListResidentChangeEvents } from "@/hooks/useResidentChangeEvents";
import { useListIncidents } from "@/hooks/useIncidents";
import { useResidentAgreements } from "@/hooks/useResidentAgreements";
import { useResidentAdministrativeMaster } from "@/hooks/useResidentAdministrativeMaster";
import { useResidentCareLevelFlags } from "@/hooks/useCareLevelReview";
import { useResidentServiceExceptions } from "@/hooks/useFloorMode";
import {
  useResidentAppointmentPreparation, useResidentAppointments,
} from "@/hooks/useResidentAppointments";
import { buildResidentNeedsAttention } from "@/lib/residentNeedsAttention";
import { isCareProfileStale } from "@/lib/residentCareHeader";
import { buildResidentFaceSheetPacket } from "@/lib/residentFaceSheet";
import { buildMoveInReadinessPacket } from "@/lib/moveInReadiness";
import type { DetectionServiceException } from "@/lib/residentChangeDetection";
import { resolveResidentTab, visibleResidentTabs } from "./resident-tabs/tabs";
import type { ResidentTabProps } from "./resident-tabs/types";

// Every tab is its own chunk. The resident route shipped the administrative master, the agreement
// workspace, the portal workspace, and the support-plan section in one eager chunk that already sat
// at ~90% of its bundle budget; splitting is what keeps the header and attention panel affordable.
const ResidentCareConflictsSection = lazy(() => import("@/components/residents/ResidentCareConflictsSection"));
const ResidentChangeSignalsSection = lazy(() => import("@/components/residents/ResidentChangeSignalsSection"));
const ResidentHospitalSection = lazy(() => import("@/components/residents/ResidentHospitalSection"));
// Lazy for the same reason, and mounted only while open: the census dialog pulls in the admissions
// hook module, which nothing else on this route needs.
const ResidentCensusStatusDialog = lazy(() => import("@/components/residents/ResidentCensusStatusDialog"));

const TAB_COMPONENTS: Record<string, React.LazyExoticComponent<React.ComponentType<ResidentTabProps>>> = {
  overview: lazy(() => import("./resident-tabs/OverviewTab")),
  care: lazy(() => import("./resident-tabs/CareServicesTab")),
  assessments: lazy(() => import("./resident-tabs/AssessmentsTab")),
  "support-plan": lazy(() => import("./resident-tabs/SupportPlanTab")),
  incidents: lazy(() => import("./resident-tabs/IncidentsChangesTab")),
  appointments: lazy(() => import("./resident-tabs/AppointmentsTab")),
  documents: lazy(() => import("./resident-tabs/DocumentsTab")),
  financial: lazy(() => import("./resident-tabs/FinancialTab")),
  timeline: lazy(() => import("./resident-tabs/TimelineTab")),
};

export default function ResidentDetail() {
  const { id } = useParams<{ id: string }>();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const { user } = useAuth();

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const canDelete = ["platform_admin", "org_admin"].includes(user?.role ?? "");
  const isPlatformRoute = location.startsWith("/admin/");
  // Platform-admin resident charts are reachable via multiple entry points (e.g. Alerts, Document Analyzer).
  // There is no /admin/residents list route; keep nested links working, but return "Back" to a valid origin.
  const residentPathPrefix = isPlatformRoute ? "/admin/residents" : "/app/residents";
  const backDestination = isPlatformRoute
    ? { href: "/admin/alerts", label: "Alerts" }
    : { href: residentPathPrefix, label: "Residents" };

  const { data: resident, isLoading, isError, error, refetch } = useGetResident(id);
  usePageTitle(resident ? `${resident.last_name}, ${resident.first_name}` : undefined);
  const { data: facilities } = useListFacilities();
  const { data: items, isLoading: itemsLoading, isError: itemsError, error: itemsErr, refetch: refetchItems } = useListResidentComplianceItems(id);
  const { data: documents, isLoading: documentsLoading, isError: documentsError, error: documentsErr, refetch: refetchDocuments } = useListResidentDocuments(id);
  const { data: informalSupports, isLoading: informalSupportsLoading } = useListResidentInformalSupports(id);
  const { data: administrativeMaster } = useResidentAdministrativeMaster(id);
  // Same query keys the header panel and tabs use, so React Query serves each from one fetch.
  const careHeader = useResidentCareHeader(id);
  const snapshot = useResident360Snapshot(id);
  const { data: changeEvents, isError: changeEventsError, error: changeEventsErr, refetch: refetchChangeEvents } = useListResidentChangeEvents({ residentId: id });
  const { data: residentIncidents, isError: incidentsError, error: incidentsErr, refetch: refetchIncidents } = useListIncidents({ residentId: id });
  const { data: agreementData, isError: agreementsError, error: agreementsErr, refetch: refetchAgreements } = useResidentAgreements(id);
  const careLevelResident = resident
    ? { id: resident.id, first_name: resident.first_name, last_name: resident.last_name, room: resident.room }
    : null;
  const careLevelFlags = useResidentCareLevelFlags(id, resident?.facility_id, careLevelResident);
  // Phase 4b floor-execution exception rows — same source change detection and care conflicts use.
  const serviceExceptionsQuery = useResidentServiceExceptions(id);
  // Two indexed, resident-scoped reads that also back the Appointments tab, so opening the tab
  // costs nothing more. The care-level review card was deliberately kept out of the shell because
  // feeding it meant loading the 11-query financial workspace on every resident view; this is the
  // other side of that judgement -- these are cheap enough that the cards are worth the shell.
  const appointmentsQuery = useResidentAppointments(id);
  const appointmentIds = useMemo(
    () => (appointmentsQuery.data ?? []).map((row) => row.id),
    [appointmentsQuery.data],
  );
  const appointmentPreparationQuery = useResidentAppointmentPreparation(appointmentIds);

  const [censusDialogOpen, setCensusDialogOpen] = useState(false);

  const facility = facilities?.find((f) => f.id === resident?.facility_id);
  // instantiate_resident_compliance_items() only seeds rule-pack rows for PCH/ALR (Phase 5) --
  // mirror that gate here so an unsupported facility type can't get a significant_change_reassessment
  // item via this button either (the RPC now enforces this server-side too).
  const isTrackedFacilityType = !!facility?.facility_type
    && (PCH_ALR_ONLY_FACILITY_TYPES as readonly string[]).includes(facility.facility_type);

  const tabs = useMemo(
    () => visibleResidentTabs({ isTrackedFacilityType, canManage }),
    [isTrackedFacilityType, canManage],
  );
  const requestedTab = new URLSearchParams(search).get("tab");
  const activeTab = resolveResidentTab(requestedTab, tabs);
  const selectTab = (tabId: string) => {
    const params = new URLSearchParams(search);
    params.set("tab", tabId);
    // Tab state lives in the URL so a resident view can be bookmarked and shared.
    navigate(`${location}?${params.toString()}`, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (isError) {
    return <QueryError what="this resident" error={error} onRetry={() => void refetch()} />;
  }

  if (!resident) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Resident not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={backDestination.href}>Back to {backDestination.label}</Link>
        </Button>
      </div>
    );
  }

  const faceSheetPacket = buildResidentFaceSheetPacket({
    resident,
    facility,
    supports: informalSupports ?? [],
    complianceItems: items ?? [],
    documents: documents ?? [],
    administrative: administrativeMaster,
  });
  // The move-in packet stays the single source for admission blockers -- Needs Attention consumes
  // its blocker count rather than re-deriving one that could disagree with the packet on screen.
  const moveInPacket = buildMoveInReadinessPacket({
    resident,
    facilityType: facility?.facility_type,
    complianceItems: items ?? [],
    documents: documents ?? [],
    supports: informalSupports ?? [],
    officialContacts: administrativeMaster?.contacts ?? [],
  });

  const needsAttentionLoading = itemsLoading
    || documentsLoading
    || careHeader.isLoading
    || careLevelFlags.isLoading
    || serviceExceptionsQuery.isLoading
    || appointmentsQuery.isLoading
    // Only counts while there is something to fetch: with no appointments the preparation query is
    // disabled, and react-query reports a disabled query as loading forever. Treating that as
    // "still loading" would leave the panel showing a spinner on every resident who has never had
    // an appointment.
    || (appointmentIds.length > 0 && appointmentPreparationQuery.isLoading);
  const needsAttentionError = careHeader.isError
    || itemsError
    || documentsError
    || changeEventsError
    || incidentsError
    || agreementsError
    || careLevelFlags.isError
    || serviceExceptionsQuery.isError
    || appointmentsQuery.isError
    || (appointmentIds.length > 0 && appointmentPreparationQuery.isError);
  const needsAttentionFailure = [
    careHeader.isError ? careHeader.error : null,
    itemsError ? itemsErr : null,
    documentsError ? documentsErr : null,
    changeEventsError ? changeEventsErr : null,
    incidentsError ? incidentsErr : null,
    agreementsError ? agreementsErr : null,
    careLevelFlags.isError ? careLevelFlags.error : null,
    serviceExceptionsQuery.isError ? serviceExceptionsQuery.error : null,
    appointmentsQuery.isError ? appointmentsQuery.error : null,
    appointmentIds.length > 0 && appointmentPreparationQuery.isError ? appointmentPreparationQuery.error : null,
  ].find((value): value is Error => value instanceof Error) ?? null;
  const typedServiceExceptions: DetectionServiceException[] = (serviceExceptionsQuery.data ?? []).map((row) => ({
    completion_response: row.completion_response,
    documented_assistance_level: row.documented_assistance_level,
    service_name: row.service_name,
    at: row.performed_at ?? row.scheduled_start,
  }));
  const needsAttentionCards = careHeader.data
    ? buildResidentNeedsAttention({
      resident,
      residentHref: `${residentPathPrefix}/${resident.id}`,
      complianceItems: items ?? [],
      documents: documents ?? [],
      changeEvents: changeEvents ?? [],
      incidents: residentIncidents ?? [],
      agreements: agreementData?.agreements ?? [],
      moveInBlockers: moveInPacket.blockers,
      hospitalState: careHeader.data.hospital.state,
      hospitalSince: careHeader.data.hospital.since,
      appointments: appointmentsQuery.data ?? [],
      appointmentPreparation: appointmentPreparationQuery.data ?? [],
      supportPlan: careHeader.data.supportPlan
        ? {
          versionNumber: careHeader.data.supportPlan.versionNumber,
          state: careHeader.data.supportPlan.state,
          reviewDueDate: careHeader.data.supportPlan.reviewDueDate,
        }
        : null,
      pendingActivation: careHeader.data.pendingActivation
        ? {
          versionNumber: careHeader.data.pendingActivation.versionNumber,
          effectiveDate: careHeader.data.pendingActivation.effectiveDate,
        }
        : null,
      careProfileStale: isCareProfileStale(careHeader.data.care.asOf),
      careProfileAsOf: careHeader.data.care.asOf,
      serviceExceptions: typedServiceExceptions,
      // Snapshot aggregate is only a fallback while typed rows have not loaded yet.
      serviceExceptionsLast7Days: snapshot.data?.serviceDelivery.exceptionsLast7Days ?? 0,
      careLevelFlags: careLevelFlags.flags.map((flag) => ({ kind: flag.kind, message: flag.message })),
    })
    : [];

  const ActiveTabComponent = TAB_COMPONENTS[activeTab] ?? TAB_COMPONENTS.overview;
  const tabProps: ResidentTabProps = {
    resident, facility, canManage, canDelete, isTrackedFacilityType, residentPathPrefix, isPlatformRoute,
  };

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="space-y-6 print:hidden">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={backDestination.href}><ArrowLeft className="mr-2 h-4 w-4" /> Back to {backDestination.label}</Link>
          </Button>
        </div>

        <ResidentCareHeaderPanel
          residentId={resident.id}
          documents={documents ?? []}
          canManage={canManage}
          actions={
            <>
              <EntityHistoryDrawer entityType="residents" entityId={resident.id} title="Resident history" />
              {!isPlatformRoute && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/residents/${id}/chart`}><HeartPulse className="mr-2 h-3.5 w-3.5" /> Clinical chart</Link>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => window.print()} disabled={informalSupportsLoading || itemsLoading || documentsLoading}>
                <Printer className="mr-2 h-3.5 w-3.5" /> Print Face Sheet
              </Button>
              {/* Was a two-option Select writing residents.status directly. That bypassed the census
                  workflow -- the discharged resident kept their bed, which set_bed_availability then
                  refused to release ("Occupied or reserved beds must be released through census
                  workflow") -- and it could not express five of the seven lifecycle states. The
                  dialog routes every change through transition_resident_census, which releases the
                  bed, writes the census event, and needs the reason it collects. */}
              {canManage ? (
                <Button variant="outline" size="sm" onClick={() => setCensusDialogOpen(true)}>
                  Change status
                </Button>
              ) : null}
            </>
          }
        />

        {resident.status === "discharged" && resident.discharge_date && (
          <p className="text-sm text-muted-foreground">Discharged {formatDateOnly(resident.discharge_date)}</p>
        )}

        <ResidentNeedsAttentionPanel
          cards={needsAttentionCards}
          isLoading={needsAttentionLoading}
          isError={needsAttentionError}
          error={needsAttentionFailure}
          onRetry={() => {
            void careHeader.refetch();
            void refetchItems();
            void refetchDocuments();
            void refetchChangeEvents();
            void refetchIncidents();
            void refetchAgreements();
            void careLevelFlags.refetch();
            void serviceExceptionsQuery.refetch();
            void appointmentsQuery.refetch();
            if (appointmentIds.length > 0) void appointmentPreparationQuery.refetch();
          }}
        />

        <Suspense fallback={null}>
          <ResidentCareConflictsSection
            residentId={resident.id}
            residentHref={`${residentPathPrefix}/${resident.id}`}
          />
        </Suspense>

        <Suspense fallback={null}>
          <ResidentHospitalSection
            residentId={resident.id}
            residentHref={`${residentPathPrefix}/${resident.id}`}
            canManage={canManage}
          />
        </Suspense>

        <Suspense fallback={null}>
          <ResidentChangeSignalsSection
            residentId={resident.id}
            residentHref={`${residentPathPrefix}/${resident.id}`}
          />
        </Suspense>

        <div role="tablist" aria-label="Resident record sections" className="flex flex-wrap gap-1 border-b">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`resident-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls="resident-tab-panel"
              onClick={() => selectTab(tab.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id="resident-tab-panel" aria-labelledby={`resident-tab-${activeTab}`}>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ActiveTabComponent {...tabProps} />
          </Suspense>
        </div>
      </div>

      {censusDialogOpen && (
        <Suspense fallback={null}>
          <ResidentCensusStatusDialog
            open
            onOpenChange={setCensusDialogOpen}
            residentId={resident.id}
            residentName={`${resident.first_name} ${resident.last_name}`}
            currentStatus={resident.status}
            moveInHref={isPlatformRoute ? undefined : "/app/admissions"}
          />
        </Suspense>
      )}

      <ResidentFaceSheet packet={faceSheetPacket} />
    </div>
  );
}
