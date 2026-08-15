import { useMemo, useState } from "react";
import { ClipboardCheck, Download } from "lucide-react";
import { useCareLevelReview } from "@/hooks/useCareLevelReview";
import {
  careLevelStatusBadgeClass,
  careLevelStatusLabel,
  careLevelWorklist,
  summarizeCareLevelReview,
  type ResidentLike,
} from "@/lib/careLevelReview";
import { csvEscape } from "@/lib/csv";
import { downloadCsvText } from "@/lib/browserDownload";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { money, today } from "./helpers";

type ReviewFilter = "all" | "high" | "attention" | "info";

// Facility-wide care-level / billing review: surfaces active residents whose billed level of care may
// need reconfirming against their latest assessment. Read-only signals; selecting a row opens that
// resident's financial record below to act on the rate agreement.
export function CareLevelReviewSection({
  facilityId,
  residents,
  onSelectResident,
}: {
  facilityId: string;
  residents: ResidentLike[];
  onSelectResident: (id: string) => void;
}) {
  const { rows, isLoading, isError, error } = useCareLevelReview(facilityId, residents);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const summary = useMemo(() => summarizeCareLevelReview(rows), [rows]);
  const worklist = useMemo(() => careLevelWorklist(rows), [rows]);
  const filtered = useMemo(
    () => (filter === "all" ? worklist : worklist.filter((row) => row.status === filter)),
    [worklist, filter],
  );
  const toggle = (value: Exclude<ReviewFilter, "all">) => setFilter((current) => (current === value ? "all" : value));

  const exportCsv = () => {
    const header = ["Resident", "Room", "Status", "Level-of-care charge", "Rate effective", "Last assessed", "Days since assessed", "Signals"];
    const lines = worklist.map((row) =>
      [
        row.residentName,
        row.room ?? "",
        careLevelStatusLabel(row.status),
        row.levelOfCareCharge == null ? "" : String(row.levelOfCareCharge),
        row.currentRateEffectiveFrom ?? "",
        row.lastAssessedAt ? formatDateForDisplay(row.lastAssessedAt) : "",
        row.daysSinceAssessed == null ? "" : String(row.daysSinceAssessed),
        row.flags.map((flag) => flag.message).join(" | "),
      ]
        .map(csvEscape)
        .join(","),
    );
    const csv = [header.map(csvEscape).join(","), ...lines].join("\n");
    downloadCsvText(`care-level-review-${today()}.csv`, csv);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Care-level review
            </CardTitle>
            <CardDescription>
              Active residents whose billed level of care may need reconfirming against their latest
              assessment. These are review signals from recorded data — confirm each in the rate agreement.
            </CardDescription>
          </div>
          {worklist.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading care-level review…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load care-level review: {error?.message}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active residents to review at this facility.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ReviewStat label="Active residents" value={summary.total} />
              <ReviewStat label="Action needed" value={summary.high} active={filter === "high"} onClick={() => toggle("high")} />
              <ReviewStat label="Review due" value={summary.attention} active={filter === "attention"} onClick={() => toggle("attention")} />
              <ReviewStat label="Verify" value={summary.info} active={filter === "info"} onClick={() => toggle("info")} />
            </div>
            {worklist.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                All {summary.total} active residents have a current, assessment-backed level of care.
              </p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No residents in this category.</p>
            ) : (
              <div className="space-y-2">
                {filtered.map((row) => (
                  <button
                    key={row.residentId}
                    type="button"
                    onClick={() => onSelectResident(row.residentId)}
                    className="flex w-full flex-col gap-1 rounded-lg border p-3 text-left hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {row.residentName}
                        {row.room ? ` · Room ${row.room}` : ""}
                      </span>
                      <Badge className={careLevelStatusBadgeClass(row.status)}>{careLevelStatusLabel(row.status)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Level-of-care charge {row.levelOfCareCharge == null ? "—" : money(row.levelOfCareCharge)}
                      {row.currentRateEffectiveFrom ? ` · rate effective ${formatDateForDisplay(row.currentRateEffectiveFrom)}` : ""}
                      {row.lastAssessedAt ? ` · last assessed ${formatDateForDisplay(row.lastAssessedAt)}` : " · never assessed"}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {row.flags.map((flag) => (
                        <li key={flag.kind} className="text-xs text-muted-foreground">
                          • {flag.message}
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewStat({ label, value, active, onClick }: { label: string; value: number; active?: boolean; onClick?: () => void }) {
  const inner = (
    <div className={`rounded-lg border p-3 ${active ? "ring-2 ring-primary" : ""}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="block w-full text-left" aria-pressed={active}>
      {inner}
    </button>
  ) : (
    inner
  );
}
