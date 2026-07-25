import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, CheckCircle2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { useListIncidents } from "@/hooks/useIncidents";
import { useListResidentChangeEvents } from "@/hooks/useResidentChangeEvents";
import { useResidentServiceExceptions, useResidentUnscheduledServices } from "@/hooks/useFloorMode";
import {
  detectResidentChangeSignals, summarizeChangeSignals, type ChangeSignal,
} from "@/lib/residentChangeDetection";
import { formatDateForDisplay } from "@/lib/dateUtils";

/**
 * Meals, weights, and hospital episodes are read here rather than through a shared hook because this
 * is the only surface that needs them, and the section is a lazy chunk -- keeping the queries local
 * means the resident shell never pays for them.
 */
function useDetectionSupplements(residentId: string) {
  const meals = useQuery({
    queryKey: ["detection-meals", residentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_meal_records")
        .select("intake_percent, served_at")
        .eq("resident_id", residentId)
        .gte("served_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
        .order("served_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data as { intake_percent: number | null; served_at: string }[];
    },
  });

  const weights = useQuery({
    queryKey: ["detection-weights", residentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_weight_readings")
        .select("weight_lbs, measured_at")
        .eq("resident_id", residentId)
        .order("measured_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as { weight_lbs: number; measured_at: string }[];
    },
  });

  const hospital = useQuery({
    queryKey: ["detection-hospital", residentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hospital_transfer_episodes")
        .select("transfer_time, destination, status")
        .eq("resident_id", residentId)
        .order("transfer_time", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as { transfer_time: string; destination: string | null; status: string }[];
    },
  });

  return { meals, weights, hospital };
}

function SignalCard({ signal }: { signal: ChangeSignal }) {
  return (
    <div className={`rounded-md border p-3 ${signal.severity === "high" ? "border-l-4 border-l-destructive" : "border-l-4 border-l-amber-500"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">{signal.title}</p>
        <Badge variant="outline" className="text-[10px]">{signal.responsibleRole}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{signal.rationale}</p>

      {/* The records behind the claim. A detection that cannot show its evidence is an assertion. */}
      <div className="mt-2 rounded-md bg-muted/40 p-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Supporting records · {formatDateForDisplay(signal.windowStart.slice(0, 10))} to {formatDateForDisplay(signal.windowEnd.slice(0, 10))}
        </p>
        <ul className="mt-1 space-y-0.5">
          {signal.evidence.map((entry, index) => (
            <li key={`${entry.label}-${index}`} className="text-xs text-muted-foreground">
              {entry.label}{entry.at ? ` — ${formatDateForDisplay(entry.at.slice(0, 10))}` : ""}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-sm">
        <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span><span className="font-medium">Recommended review: </span>{signal.recommendedReview}</span>
      </p>
    </div>
  );
}

/**
 * Change intelligence. Every signal states what changed, the records that say so, the date range,
 * why it matters, the recommended review, and who must respond.
 *
 * There is deliberately no score. A single number would be easier to sort by and impossible to
 * defend, and the request rules it out by name.
 */
export default function ResidentChangeSignalsSection({
  residentId, residentHref,
}: {
  residentId: string;
  residentHref: string;
}) {
  const { data: serviceExceptions } = useResidentServiceExceptions(residentId);
  const { data: unscheduled } = useResidentUnscheduledServices(residentId, 50);
  const { data: changeEvents } = useListResidentChangeEvents({ residentId });
  const { data: incidents } = useListIncidents({ residentId });
  const { meals, weights, hospital } = useDetectionSupplements(residentId);

  const signals = detectResidentChangeSignals({
    serviceExceptions: (serviceExceptions ?? []).map((entry) => ({
      completion_response: entry.completion_response,
      documented_assistance_level: entry.documented_assistance_level,
      service_name: entry.service_name,
      at: entry.performed_at ?? entry.scheduled_start,
    })),
    unscheduledServices: (unscheduled ?? []).map((entry) => ({
      service_kind: entry.service_kind,
      occurred_at: entry.occurred_at,
    })),
    changeEvents: (changeEvents ?? []).map((entry) => ({
      category: entry.category,
      identified_at: entry.identified_at,
      status: entry.status,
    })),
    incidents: (incidents ?? []).map((entry) => ({
      incident_type: entry.incident_type,
      occurred_at: entry.occurred_at,
    })),
    // intake_percent is 0-100; the detector works in a 0..1 ratio.
    mealRecords: (meals.data ?? []).map((entry) => ({
      intake_ratio: entry.intake_percent === null ? null : entry.intake_percent / 100,
      recorded_at: entry.served_at,
    })),
    weightReadings: (weights.data ?? []).map((entry) => ({
      weight_lbs: Number(entry.weight_lbs),
      measured_at: entry.measured_at,
    })),
    hospitalEpisodes: (hospital.data ?? []).map((entry) => ({
      transfer_time: entry.transfer_time,
      destination: entry.destination,
      status: entry.status,
    })),
  });
  const summary = summarizeChangeSignals(signals);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" /> What has changed
            </CardTitle>
            <CardDescription>
              Patterns detected from records staff already created. Prompts for review, not conclusions.
            </CardDescription>
          </div>
          {summary.total > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.high > 0 && <Badge variant="outline" className="border-destructive text-destructive">{summary.high} high</Badge>}
              {summary.attention > 0 && <Badge variant="outline">{summary.attention} attention</Badge>}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {signals.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            No patterns detected in this resident's recent records.
          </p>
        ) : (
          <>
            {signals.map((signal) => <SignalCard key={signal.kind} signal={signal} />)}
            <p className="pt-1 text-xs text-muted-foreground">
              Acting on one of these starts a{" "}
              <Link href={`${residentHref}?tab=incidents`} className="underline">change-of-condition record</Link>
              {" "}— these detections never create one on their own.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
