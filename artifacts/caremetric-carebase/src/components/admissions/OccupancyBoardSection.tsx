import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { supabase } from "@/lib/supabase";

interface OccupancyBoard {
  facilityName: string;
  licensedCapacity: number | null;
  licensedCapacitySource: string;
  license: { licenseNumber: string; status: string; expiresOn: string | null } | null;
  census: {
    activeResidents: number;
    temporarilyOut: number;
    hospitalLeave: number;
    occupyingABed: number;
  };
  buildings: {
    id: string;
    name: string;
    building_allocated_capacity: number;
    beds: number;
    available: number;
    reserved: number;
    occupied: number;
    maintenance_hold: number;
    temporarily_unavailable: number;
    occupied_but_away: number;
  }[];
  reconciliation: {
    residentsWithoutABed: { residentId: string; name: string; status: string }[];
    bedsHeldByNonResidents: { bedId: string; bedLabel: string; residentStatus: string }[];
  };
}

const CAPACITY_SOURCE_NOTE: Record<string, string> = {
  no_active_license_on_file:
    "No active licence is on file, so there is no licensed capacity to compare against. The bed count below is what the building physically holds, which is not the same thing.",
  license_records_no_capacity:
    "The licence on file records no capacity figure. Add it to the licence record rather than inferring one from the bed count.",
  facility_license: "",
};

function useOccupancyBoard(facilityId: string | undefined) {
  return useQuery({
    queryKey: ["occupancy-board", facilityId],
    enabled: Boolean(facilityId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_facility_occupancy_board" as never, {
        p_facility_id: facilityId,
      } as never);
      if (error) throw error;
      return data as unknown as OccupancyBoard;
    },
  });
}

/**
 * The occupancy board (program plan Phase 9b, request item 21).
 *
 * LICENSED CAPACITY IS A REGULATORY NUMBER. It comes from the facility licence, never from counting
 * beds, and when no licence is on file this surface says so rather than showing the bed count in its
 * place. A facility that believes it has room it is not licensed for finds out at a survey.
 */
export default function OccupancyBoardSection({ facilityId }: { facilityId: string | undefined }) {
  const { data, isLoading, isError, error, refetch } = useOccupancyBoard(facilityId);

  if (!facilityId) return null;
  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (isError) {
    return (
      <QueryError
        what="the occupancy board"
        error={error}
        onRetry={() => void refetch()}
      />
    );
  }
  if (!data) return null;

  const occupied = data.census.occupyingABed;
  const overCapacity = data.licensedCapacity !== null && occupied > data.licensedCapacity;
  const capacityNote = CAPACITY_SOURCE_NOTE[data.licensedCapacitySource] ?? "";
  const mismatches =
    data.reconciliation.residentsWithoutABed.length + data.reconciliation.bedsHeldByNonResidents.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Occupancy
            </CardTitle>
            <CardDescription>{data.facilityName}</CardDescription>
          </div>
          {overCapacity && (
            <Badge variant="outline" className="border-destructive text-destructive">
              Census exceeds licensed capacity
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Licensed capacity</p>
            <p className="text-2xl font-semibold tabular-nums">
              {data.licensedCapacity ?? "—"}
            </p>
            {data.license && (
              <p className="text-[11px] text-muted-foreground">
                Licence {data.license.licenseNumber}
              </p>
            )}
          </div>
          <div className={`rounded-md border p-3 ${overCapacity ? "border-destructive" : ""}`}>
            <p className="text-xs text-muted-foreground">Holding a bed tonight</p>
            <p className={`text-2xl font-semibold tabular-nums ${overCapacity ? "text-destructive" : ""}`}>
              {occupied}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Includes {data.census.hospitalLeave} on hospital leave
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Occupancy</p>
            <p className="text-2xl font-semibold tabular-nums">
              {data.licensedCapacity ? `${Math.round((occupied / data.licensedCapacity) * 100)}%` : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground">Against licensed capacity</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Available beds</p>
            <p className="text-2xl font-semibold tabular-nums">
              {data.buildings.reduce((sum, building) => sum + building.available, 0)}
            </p>
          </div>
        </div>

        {capacityNote && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
            <p className="text-sm">{capacityNote}</p>
          </div>
        )}

        {data.buildings.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="p-2 text-left">Building</th>
                  <th className="p-2 text-right">Beds</th>
                  <th className="p-2 text-right">Occupied</th>
                  <th className="p-2 text-right">Away</th>
                  <th className="p-2 text-right">Reserved</th>
                  <th className="p-2 text-right">Available</th>
                  <th className="p-2 text-right">Maintenance</th>
                </tr>
              </thead>
              <tbody>
                {data.buildings.map((building) => (
                  <tr key={building.id} className="border-t">
                    <td className="p-2">{building.name}</td>
                    <td className="p-2 text-right tabular-nums">{building.beds}</td>
                    <td className="p-2 text-right tabular-nums">{building.occupied}</td>
                    <td className="p-2 text-right tabular-nums">{building.occupied_but_away}</td>
                    <td className="p-2 text-right tabular-nums">{building.reserved}</td>
                    <td className="p-2 text-right tabular-nums">{building.available}</td>
                    <td className="p-2 text-right tabular-nums">{building.maintenance_hold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {mismatches > 0 && (
          <div className="rounded-md border border-amber-500/40 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              {mismatches} occupancy record{mismatches === 1 ? "" : "s"} disagree with the census
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {data.reconciliation.residentsWithoutABed.map((entry) => (
                <li key={entry.residentId}>{entry.name} is {entry.status} but occupies no bed.</li>
              ))}
              {data.reconciliation.bedsHeldByNonResidents.map((entry) => (
                <li key={entry.bedId}>
                  Bed {entry.bedLabel} is still held by a {entry.residentStatus} resident.
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
