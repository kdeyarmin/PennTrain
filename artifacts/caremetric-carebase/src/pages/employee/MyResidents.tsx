import { useMemo, useState } from "react";
import { Link } from "wouter";
import { HeartPulse, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { usePageTitle } from "@/lib/pageTitle";
import { useClinicalChartResidentOptions } from "@/hooks/useClinicalObservations";
import { filterResidentOptions } from "@/lib/clinicalObservations";

/**
 * Resident picker for caregiver clinical charting. Lists every resident the employee is
 * authorized to chart for (get_clinical_chart_resident_options -- gated the same way as the
 * chart itself, not limited to residents with a task today), so charting a vital or a note is
 * never blocked on having a scheduled service task first.
 */
export default function MyResidents() {
  usePageTitle("Resident chart");
  const [query, setQuery] = useState("");
  const options = useClinicalChartResidentOptions();
  const residents = useMemo(
    () => filterResidentOptions(options.data ?? [], query),
    [options.data, query],
  );

  return (
    <div className="space-y-5 pb-24">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <HeartPulse className="h-6 w-6 text-rose-600" />
          Resident chart
        </h1>
        <p className="text-sm text-muted-foreground">Pick a resident to record vitals or add a note.</p>
      </div>

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
      ) : (
        <div className="space-y-2">
          {residents.map((resident) => (
            <Link
              key={resident.id}
              href={`/me/residents/${resident.id}`}
              className="flex min-h-16 items-center justify-between rounded-lg border p-3 hover:bg-muted"
            >
              <span className="text-base font-medium">
                {resident.last_name}, {resident.first_name}
              </span>
              {resident.room && <Badge variant="outline">Room {resident.room}</Badge>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
