import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListAllResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
import { useListResidents } from "@/hooks/useResidents";
import { useListFacilities } from "@/hooks/useFacilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, CheckCircle, ChevronDown, ChevronUp, ClipboardList, TriangleAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { humanize } from "@/lib/utils";
import { ITEM_TYPE_LABELS, complianceStatusBadgeClassName, formatDateOnly } from "@/lib/residentCompliance";
import { summarizeResidentComplianceAnalytics } from "@/lib/residentComplianceAnalytics";
import { listUpcomingRenewals, sortOpenItemsByUrgency } from "@/lib/stateFormWorkflow";
import { StateFormWorkflowStepper } from "@/components/residents/StateFormWorkflowStepper";
import { LogChangeOfConditionDialog } from "@/components/residents/LogChangeOfConditionDialog";
import { toLocalIsoDate } from "@/lib/dateUtils";

const OPEN_STATUSES = new Set(["expired", "missing", "due_soon"]);
const RENEWAL_WINDOW_DAYS = 60;

// Structural shape of useListAllResidentComplianceItems' selected columns (that hook selects a
// subset, so rows aren't the full generated table type).
interface CenterItem {
  id: string;
  resident_id: string;
  facility_id: string;
  item_type: string;
  status: string;
  due_date: string | null;
  completed_date: string | null;
  triggered_by_item_id: string | null;
  renewal_interval_days: number | null;
}

// The guided cross-resident work surface for PA state-required resident forms: everything that
// needs action now (sorted by urgency), yearly renewals coming due, and the change-of-condition
// entry point -- with the same per-item workflow stepper ResidentDetail uses, so completing a
// form never requires hunting through individual resident pages first. The flat filterable table
// stays available at /app/resident-compliance for audit-style review.
export default function StateFormsCenter() {
  const { user } = useAuth();
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");

  const [facilityId, setFacilityId] = useState<string>("all");
  const [showChangeDialog, setShowChangeDialog] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const { data: facilities } = useListFacilities();
  const { data: residents } = useListResidents();
  // One unfiltered-by-status query powers the tiles, the queue, and the renewal window; the
  // facility filter is server-side because it changes what every section shows.
  const { data: items, isLoading } = useListAllResidentComplianceItems({
    facilityId: facilityId !== "all" ? facilityId : undefined,
  });

  const today = toLocalIsoDate();
  const facilityById = useMemo(() => new Map((facilities ?? []).map((f) => [f.id, f])), [facilities]);
  const residentById = useMemo(() => new Map((residents ?? []).map((r) => [r.id, r])), [residents]);
  const itemById = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);

  // Discharged residents' items stay in the database as history but aren't actionable work --
  // the queue and renewal list only surface forms for residents currently in the home.
  const activeResidentIds = useMemo(
    () => new Set((residents ?? []).filter((r) => r.status === "active").map((r) => r.id)),
    [residents],
  );
  const activeItems = useMemo(
    () => (items ?? []).filter((i) => activeResidentIds.has(i.resident_id)),
    [items, activeResidentIds],
  );

  const activeResidents = useMemo(() => (residents ?? []).filter((r) => r.status === "active"), [residents]);
  const summary = summarizeResidentComplianceAnalytics(activeResidents, activeItems, today);
  const openItems = useMemo(
    () => sortOpenItemsByUrgency(activeItems.filter((i) => OPEN_STATUSES.has(i.status)), today),
    [activeItems, today],
  );
  const upcomingRenewals = useMemo(
    () => listUpcomingRenewals(activeItems, today, RENEWAL_WINDOW_DAYS),
    [activeItems, today],
  );

  const renderItemRow = (item: CenterItem) => {
    const resident = residentById.get(item.resident_id);
    const facility = facilityById.get(item.facility_id);
    const expanded = expandedItemId === item.id;
    const triggeredByItemType = item.triggered_by_item_id ? itemById.get(item.triggered_by_item_id)?.item_type : undefined;
    return (
      <div key={item.id} className="p-3 rounded-lg border text-sm space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium">
                {resident ? (
                  <Link href={`/app/residents/${item.resident_id}`} className="hover:underline">
                    {resident.last_name}, {resident.first_name}
                  </Link>
                ) : "—"}
              </span>
              <span className="text-muted-foreground">·</span>
              <span>{ITEM_TYPE_LABELS[item.item_type] ?? humanize(item.item_type)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {facility?.name ?? "—"} · Due {item.due_date ? formatDateOnly(item.due_date) : "—"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={complianceStatusBadgeClassName(item.status)} variant="outline">
              {humanize(item.status)}
            </Badge>
            <Button
              variant="ghost" size="sm" className="h-7 text-xs"
              onClick={() => setExpandedItemId(expanded ? null : item.id)}
            >
              {expanded ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
              Workflow
            </Button>
          </div>
        </div>
        {expanded && resident && (
          <StateFormWorkflowStepper
            item={item}
            resident={resident}
            facilityType={facility?.facility_type}
            canManage={canManage}
            triggeredByItemType={triggeredByItemType}
          />
        )}
      </div>
    );
  };

  const tiles = [
    { label: "Expired", value: summary.expiredItems, tone: "text-destructive" },
    { label: "Missing", value: summary.missingItems, tone: "text-foreground" },
    { label: "Due Soon", value: summary.dueSoonItems, tone: "text-warning" },
    { label: `Renewals (${RENEWAL_WINDOW_DAYS}d)`, value: upcomingRenewals.length, tone: "text-foreground" },
    { label: "Residents Needing Forms", value: summary.residentsWithOpenItems, tone: "text-foreground" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">State Forms</h1>
          <p className="text-muted-foreground">
            Every DHS-required resident form in one guided queue — prepare, print, and attach the
            signed state form without hunting through individual residents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setShowChangeDialog(true)}>
              <TriangleAlert className="mr-2 h-3.5 w-3.5" /> Log Change of Condition
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/resident-compliance">Open flat report</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardContent className="pt-4 pb-3">
              <p className={`text-2xl font-bold ${tile.tone}`}>{tile.value}</p>
              <p className="text-xs text-muted-foreground">{tile.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Select value={facilityId} onValueChange={(v) => { setFacilityId(v); setExpandedItemId(null); }}>
        <SelectTrigger className="w-56"><SelectValue placeholder="All Facilities" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Facilities</SelectItem>
          {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
          <ClipboardList className="h-5 w-5" /> Needs Action Now
        </h2>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />)}
          </div>
        ) : openItems.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <CheckCircle className="h-10 w-10 text-success mx-auto mb-2" />
              <p className="text-muted-foreground">All state forms are current — nothing needs action.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">{openItems.map(renderItemRow)}</div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
          <CalendarClock className="h-5 w-5" /> Renewals Coming Up
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Annual reassessments and medical evaluations due within {RENEWAL_WINDOW_DAYS} days.
          Starting a reassessment pre-fills last year's finalized answers so only what changed
          needs revising.
        </p>
        {!isLoading && upcomingRenewals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No renewals due in the next {RENEWAL_WINDOW_DAYS} days.</p>
        ) : (
          <div className="space-y-2">{upcomingRenewals.map(renderItemRow)}</div>
        )}
      </div>

      <LogChangeOfConditionDialog
        open={showChangeDialog}
        onOpenChange={setShowChangeDialog}
        residents={activeResidents}
      />
    </div>
  );
}
