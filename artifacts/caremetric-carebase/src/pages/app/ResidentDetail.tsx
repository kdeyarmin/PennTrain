import { lazy, Suspense, useMemo } from "react";
import { useParams, Link, useLocation, useSearch } from "wouter";
import { useGetResident, useUpdateResident } from "@/hooks/useResidents";
import { usePageTitle } from "@/lib/pageTitle";
import { useListResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
import { useListResidentDocuments } from "@/hooks/useResidentDocuments";
import { useListResidentInformalSupports } from "@/hooks/useResidentInformalSupports";
import { useListFacilities } from "@/hooks/useFacilities";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { ArrowLeft, HeartPulse, Printer } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { humanize } from "@/lib/utils";
import { formatDateOnly } from "@/lib/residentCompliance";
import { PCH_ALR_ONLY_FACILITY_TYPES } from "@/lib/facilityTypes";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { ResidentFaceSheet } from "@/components/residents/ResidentFaceSheet";
import { ResidentCareHeaderPanel } from "@/components/residents/ResidentCareHeader";
import { ResidentNeedsAttentionPanel } from "@/components/residents/ResidentNeedsAttention";
import { useResidentCareHeader } from "@/hooks/useResidentCareHeader";
import { useResident360Snapshot } from "@/hooks/useResident360";
import { useListResidentChangeEvents } from "@/hooks/useResidentChangeEvents";
import { useListIncidents } from "@/hooks/useIncidents";
import { useResidentAgreements } from "@/hooks/useResidentAgreements";
import { useResidentAdministrativeMaster } from "@/hooks/useResidentAdministrativeMaster";
import { buildResidentNeedsAttention } from "@/lib/residentNeedsAttention";
import { isCareProfileStale } from "@/lib/residentCareHeader";
import { buildResidentFaceSheetPacket } from "@/lib/residentFaceSheet";
import { buildMoveInReadinessPacket } from "@/lib/moveInReadiness";
import { resolveResidentTab, visibleResidentTabs } from "./resident-tabs/tabs";
import type { ResidentTabProps } from "./resident-tabs/types";

// Every tab is its own chunk. The resident route shipped the administrative master, the agreement
// workspace, the portal workspace, and the support-plan section in one eager chunk that already sat
// at ~90% of its bundle budget; splitting is what keeps the header and attention panel affordable.
const ResidentCareConflictsSection = lazy(() => import("@/components/residents/ResidentCareConflictsSection"));

const TAB_COMPONENTS: Record<string, React.LazyExoticComponent<React.ComponentType<ResidentTabProps>>> = {
  overview: lazy(() => import("./resident-tabs/OverviewTab")),
  care: lazy(() => import("./resident-tabs/CareServicesTab")),
  assessments: lazy(() => import("./resident-tabs/AssessmentsTab")),
  "support-plan": lazy(() => import("./resident-tabs/SupportPlanTab")),
  incidents: lazy(() => import("./resident-tabs/IncidentsChangesTab")),
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
  const { data: items, isLoading: itemsLoading } = useListResidentComplianceItems(id);
  const { data: documents, isLoading: documentsLoading } = useListResidentDocuments(id);
  const { data: informalSupports, isLoading: informalSupportsLoading } = useListResidentInformalSupports(id);
  const { data: administrativeMaster } = useResidentAdministrativeMaster(id);
  // Same query keys the header panel and tabs use, so React Query serves each from one fetch.
  const careHeader = useResidentCareHeader(id);
  const snapshot = useResident360Snapshot(id);
  const { data: changeEvents } = useListResidentChangeEvents({ residentId: id });
  const { data: residentIncidents } = useListIncidents({ residentId: id });
  const { data: agreementData } = useResidentAgreements(id);

  const { mutate: updateResident } = useUpdateResident();

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

  const needsAttentionLoading = itemsLoading || documentsLoading || careHeader.isLoading;
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
      supportPlan: careHeader.data.supportPlan
        ? {
          versionNumber: careHeader.data.supportPlan.versionNumber,
          state: careHeader.data.supportPlan.state,
          reviewDueDate: careHeader.data.supportPlan.reviewDueDate,
        }
        : null,
      careProfileStale: isCareProfileStale(careHeader.data.care.asOf),
      careProfileAsOf: careHeader.data.care.asOf,
      serviceExceptionsLast7Days: snapshot.data?.serviceDelivery.exceptionsLast7Days ?? 0,
      // Care-level flags need the resident's rate agreements, which live behind the 11-query
      // financial workspace. Loading that eagerly for one card is the fan-out this page is meant to
      // avoid; the check is listed in the panel's "not yet covered" section until the Financial tab
      // owns that query.
      careLevelFlags: [],
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
              {!isPlatformRoute && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/residents/${id}/chart`}><HeartPulse className="mr-2 h-3.5 w-3.5" /> Clinical chart</Link>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => window.print()} disabled={informalSupportsLoading || itemsLoading || documentsLoading}>
                <Printer className="mr-2 h-3.5 w-3.5" /> Print Face Sheet
              </Button>
              {canManage ? (
                <Select
                  value={resident.status}
                  onValueChange={(v) => updateResident({
                    id: resident.id,
                    status: v as typeof resident.status,
                    discharge_date: v === "discharged" ? toLocalIsoDate() : null,
                  })}
                >
                  <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["active", "discharged"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : null}
            </>
          }
        />

        {resident.status === "discharged" && resident.discharge_date && (
          <p className="text-sm text-muted-foreground">Discharged {formatDateOnly(resident.discharge_date)}</p>
        )}

        <ResidentNeedsAttentionPanel cards={needsAttentionCards} isLoading={needsAttentionLoading} />

        <Suspense fallback={null}>
          <ResidentCareConflictsSection
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

      <ResidentFaceSheet packet={faceSheetPacket} />
    </div>
  );
}
