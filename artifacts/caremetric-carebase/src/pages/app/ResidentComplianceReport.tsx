import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListAllResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
import { useListResidents } from "@/hooks/useResidents";
import { useListFacilities } from "@/hooks/useFacilities";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, ClipboardList } from "lucide-react";
import { ITEM_TYPE_LABELS, complianceStatusBadgeClassName } from "@/lib/residentCompliance";

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

const OPEN_STATUSES = ["due_soon", "expired", "missing"];

// Facility-wide "who's overdue" view -- the dashboard's whole reason for existing: before this,
// a facility manager had to click into every individual resident one at a time to find out
// whether their RASP/ASP items were on track. Mirrors Alerts.tsx's filter-bar + flat-query pattern.
export default function ResidentComplianceReport() {
  const [facilityId, setFacilityId] = useState<string>("all");
  const [status, setStatus] = useState<string>("open");
  const [itemType, setItemType] = useState<string>("all");

  const { data: facilities } = useListFacilities();
  const { data: residents } = useListResidents();
  const { data: items, isLoading } = useListAllResidentComplianceItems({
    facilityId: facilityId !== "all" ? facilityId : undefined,
    status: status === "open" ? OPEN_STATUSES : status !== "all" ? [status] : undefined,
    itemType: itemType !== "all" ? itemType : undefined,
  });

  const facilityById = useMemo(() => new Map((facilities ?? []).map((f) => [f.id, f])), [facilities]);
  const residentById = useMemo(() => new Map((residents ?? []).map((r) => [r.id, r])), [residents]);

  const rows = items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Resident Compliance</h1>
        <p className="text-muted-foreground">
          Every RASP/ASP deadline across every resident, in one place — filter to see what's due or
          overdue without clicking into each resident individually.
        </p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select value={facilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Facilities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Due Soon / Expired / Missing</SelectItem>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="due_soon">Due Soon</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
            <SelectItem value="compliant">Compliant</SelectItem>
          </SelectContent>
        </Select>
        <Select value={itemType} onValueChange={setItemType}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All Item Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Item Types</SelectItem>
            {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
              <p className="text-muted-foreground">Nothing matches these filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Resident</th>
                    <th>Facility</th>
                    <th>Item</th>
                    <th>Due Date</th>
                    <th>Status</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => {
                    const resident = residentById.get(item.resident_id);
                    const facility = facilityById.get(item.facility_id);
                    return (
                      <tr key={item.id}>
                        <td className="font-medium text-foreground">
                          {resident ? `${resident.last_name}, ${resident.first_name}` : "—"}
                        </td>
                        <td className="text-muted-foreground">{facility?.name ?? "—"}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <ClipboardList className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            {ITEM_TYPE_LABELS[item.item_type] ?? humanize(item.item_type)}
                          </div>
                        </td>
                        <td className="text-muted-foreground">{item.due_date ?? "—"}</td>
                        <td>
                          <Badge className={complianceStatusBadgeClassName(item.status)} variant="outline">
                            {humanize(item.status)}
                          </Badge>
                        </td>
                        <td>
                          <Link href={`/app/residents/${item.resident_id}`} className="text-sm text-primary hover:underline">
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
