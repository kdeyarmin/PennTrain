import { useMemo, useState } from "react";
import { Link } from "wouter";
import { HeartPulse, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { ResidentAvatar } from "@/components/residents/ResidentAvatar";
import { UnsyncedDraftsPanel } from "@/components/residents/UnsyncedDraftsPanel";
import { usePageTitle } from "@/lib/pageTitle";
import { useClinicalChartResidentOptions } from "@/hooks/useClinicalObservations";
import { useResidentPhotoUrls } from "@/hooks/useResidentPhotos";
import { useResidentServiceTaskQueue } from "@/hooks/useResidentServiceTasks";
import { filterResidentOptions, type ClinicalChartResidentOption } from "@/lib/clinicalObservations";

/** Only the resident id is needed here; the queue's full row shape belongs to Floor. */
interface QueueResidentRow { resident_id: string }

function ResidentRow({ resident, photoUrl }: { resident: ClinicalChartResidentOption; photoUrl?: string }) {
  return (
    <Link
      href={`/me/residents/${resident.id}`}
      className="flex min-h-16 items-center gap-3 rounded-lg border p-3 hover:bg-muted"
    >
      <ResidentAvatar firstName={resident.first_name} lastName={resident.last_name} photoUrl={photoUrl} />
      <span className="min-w-0 flex-1 text-base font-medium">
        {resident.last_name}, {resident.first_name}
      </span>
      {resident.room && <Badge variant="outline" className="shrink-0">Room {resident.room}</Badge>}
    </Link>
  );
}

/**
 * Resident picker for caregiver clinical charting. Lists every resident the employee is
 * authorized to chart for (get_clinical_chart_resident_options -- gated the same way as the
 * chart itself, not limited to residents with a task today), so charting a vital or a note is
 * never blocked on having a scheduled service task first.
 *
 * Residents the caregiver is actually working today are lifted to the top, because alphabetical
 * order is the one ordering that is never what a person on shift is looking for. That grouping is
 * derived from the same queue Floor already reads -- no second definition of "my assignment".
 */
export default function MyResidents() {
  usePageTitle("Resident chart");
  const [query, setQuery] = useState("");
  const options = useClinicalChartResidentOptions();
  const photos = useResidentPhotoUrls();

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  // No status filter: a task already documented still means this resident is on today's assignment.
  const queue = useResidentServiceTaskQueue({ from: dayStart.toISOString(), through: dayEnd.toISOString() });

  const onAssignmentIds = useMemo(
    () => new Set(((queue.data ?? []) as unknown as QueueResidentRow[]).map((task) => task.resident_id)),
    [queue.data],
  );

  const residents = useMemo(
    () => filterResidentOptions(options.data ?? [], query),
    [options.data, query],
  );
  const onAssignment = residents.filter((resident) => onAssignmentIds.has(resident.id));
  const others = residents.filter((resident) => !onAssignmentIds.has(resident.id));

  return (
    <div className="space-y-5 pb-24">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <HeartPulse className="h-6 w-6 text-rose-600" />
          Resident chart
        </h1>
        <p className="text-sm text-muted-foreground">Pick a resident to record vitals or add a note.</p>
      </div>

      <UnsyncedDraftsPanel />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or room"
          className="h-12 pl-9"
          aria-label="Search residents"
        />
      </div>

      {options.isError ? (
        <QueryError what="your residents" error={options.error} onRetry={() => void options.refetch()} />
      ) : options.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : residents.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {query ? "No residents match your search." : "No residents at your facility yet."}
        </p>
      ) : onAssignment.length === 0 ? (
        <div className="space-y-2">
          {residents.map((resident) => (
            <ResidentRow key={resident.id} resident={resident} photoUrl={photos.data?.[resident.id]} />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">On your assignment today</h2>
            {onAssignment.map((resident) => (
              <ResidentRow key={resident.id} resident={resident} photoUrl={photos.data?.[resident.id]} />
            ))}
          </div>
          {others.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Everyone else at your facility</h2>
              {others.map((resident) => (
                <ResidentRow key={resident.id} resident={resident} photoUrl={photos.data?.[resident.id]} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
