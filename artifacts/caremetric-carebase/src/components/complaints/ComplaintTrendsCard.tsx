import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/errorText";
import { useComplaintTrends } from "@/hooks/useComplaints";
import { facilityToday } from "@/lib/dateUtils";

/**
 * Ninety days back, as a plain date string. The RPC compares against `date_received::date`, which
 * `get_complaint_trends` reads in the facility's calendar -- so both ends of the default window
 * have to be facility days too.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC day, and Pennsylvania is four or five hours
 * behind it: from 20:00 ET the card opened on TOMORROW's date and looked back ninety days from
 * there, so the window a manager saw in the two pickers was one day ahead of the day the
 * complaints are filed under, every evening.
 */
function facilityDaysAgo(days: number): string {
  return facilityToday(new Date(Date.now() - days * 86_400_000));
}

interface Trends {
  total: number;
  open: number;
  highRisk: number;
  residentRights: number;
  ombudsmanReferrals: number;
  incidentLinked: number;
  byCategory: Record<string, number>;
}

/**
 * Complaints over a period, by category (BACKLOG.md G16.9).
 *
 * The page's tiles measure the present: how many are open now, how many are high risk now. The
 * question they cannot answer is whether the same complaint keeps coming back, and
 * `get_complaint_trends` answers exactly that -- a count, a category breakdown, and the two
 * escalation paths (ombudsman referral, linked incident) over a window. It had no caller.
 *
 * It takes one facility, not an organization: the function reads `p_facility_id` and refuses
 * anything outside scope, so this renders only when a specific facility is selected rather than
 * offering a control that would always fail on "All facilities".
 */
export function ComplaintTrendsCard({ facilityId }: { facilityId: string }) {
  const [from, setFrom] = useState(() => facilityDaysAgo(90));
  const [through, setThrough] = useState(() => facilityToday());
  const trends = useComplaintTrends(facilityId, from, through);
  const data = trends.data as Trends | undefined;

  const categories = Object.entries(data?.byCategory ?? {}).sort((a, b) => b[1] - a[1]);
  const invalidPeriod = Boolean(from && through && from > through);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-5 w-5" />Complaints over a period
        </CardTitle>
        <CardDescription>
          The tiles above are the present. This is the pattern — whether the same complaint keeps
          coming back at this facility, and how often it escalates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="trend-from">From</Label>
            <Input id="trend-from" type="date" className="sm:w-44" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="trend-through">Through</Label>
            <Input id="trend-through" type="date" className="sm:w-44" value={through} onChange={(event) => setThrough(event.target.value)} />
          </div>
        </div>

        {invalidPeriod && (
          <p className="text-sm text-destructive">
            The period cannot end before it starts — the server refuses it outright.
          </p>
        )}
        {!invalidPeriod && trends.isLoading && <p className="text-sm text-muted-foreground">Counting…</p>}
        {!invalidPeriod && trends.isError && (
          <p className="text-sm text-destructive">{errorText(trends.error)}</p>
        )}

        {!invalidPeriod && data && (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { label: "Received", value: data.total },
                { label: "Still open", value: data.open },
                { label: "High or imminent risk", value: data.highRisk },
                { label: "Resident rights", value: data.residentRights },
                { label: "Referred to the ombudsman", value: data.ombudsmanReferrals },
                { label: "Linked to an incident", value: data.incidentLinked },
              ].map((metric) => (
                <div key={metric.label} className="rounded border p-2">
                  <p className="text-xl font-semibold tabular-nums">{metric.value}</p>
                  <p className="text-xs text-muted-foreground">{metric.label}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">By category</p>
              {categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No complaints were received at this facility in that period.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {categories.map(([category, count]) => (
                    <Badge key={category} variant="outline">
                      {category.replace(/_/g, " ")} · {count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
