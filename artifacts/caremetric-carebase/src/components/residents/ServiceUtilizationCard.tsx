import { useState } from "react";
import { Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { errorText } from "@/lib/errorText";
import { useResidentServiceUtilization } from "@/hooks/useFloorMode";

const WINDOWS = [
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
] as const;

function CountList({ label, counts }: { label: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">None in this window.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([key, count]) => (
            <Badge key={key} variant="outline">{key.replace(/_/g, " ")} · {count}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What care was actually delivered, against the plan that says what should be (BACKLOG.md G16.10).
 *
 * `get_resident_service_utilization` returns unscheduled services, documented assistance, and
 * exceptions over a window, and had no caller. It belongs beside the support plan because that is
 * the question it answers: a resident repeatedly receiving a service the plan does not list, or
 * repeatedly refusing one it does, is the evidence that the plan needs revising -- and a support
 * plan that no longer matches the care given is what a survey finds.
 */
export function ServiceUtilizationCard({ residentId }: { residentId: string }) {
  const [days, setDays] = useState("30");
  const utilization = useResidentServiceUtilization(residentId, Number(days));
  const data = utilization.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-5 w-5" />Care actually delivered
        </CardTitle>
        <CardDescription>
          What was documented against this resident recently, next to the plan that says what should
          be. A service given repeatedly that the plan does not list is a reason to revise it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="utilization-window">Window</Label>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger id="utilization-window" className="sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WINDOWS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {utilization.isLoading && <p className="text-sm text-muted-foreground">Counting…</p>}
        {utilization.isError && <p className="text-sm text-destructive">{errorText(utilization.error)}</p>}

        {data && (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="text-2xl font-semibold tabular-nums">{data.unscheduledTotal}</span>{" "}
              <span className="text-muted-foreground">
                unscheduled service{data.unscheduledTotal === 1 ? "" : "s"} since{" "}
                {new Date(data.since).toLocaleDateString()}
              </span>
            </p>
            <CountList label="Unscheduled, by type" counts={data.unscheduled} />
            <CountList label="Documented assistance" counts={data.documentedAssistance} />
            <CountList label="Exceptions" counts={data.exceptions} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
