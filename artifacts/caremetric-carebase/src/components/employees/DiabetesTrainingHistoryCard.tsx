import { Link } from "wouter";
import { ExternalLink, Syringe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import {
  DIABETES_COURSE_CITATION,
  DIABETES_COURSE_SHORT_TITLE,
  useEmployeeDiabetesTrainingHistory,
} from "@/hooks/useDiabetesTraining";
import { formatDateForDisplay } from "@/lib/dateUtils";

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <Syringe className="h-10 w-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

/**
 * Every annual diabetes education completion this employee has recorded, newest first.
 *
 * The compliance report shows one row per employee because that is the question an inspector opens
 * with. This is the drill-down that answers "and the years before that", and each row keeps the
 * exact course version it was taken against so an old completion never appears to contain newer
 * content.
 */
export function DiabetesTrainingHistoryCard({ employeeId }: { employeeId: string | undefined }) {
  const { data, isLoading, isError, error, refetch } = useEmployeeDiabetesTrainingHistory(employeeId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Syringe className="h-5 w-5" /> {DIABETES_COURSE_SHORT_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : isError ? (
          <QueryError what="diabetes training history" error={error} onRetry={() => void refetch()} />
        ) : !data?.length ? (
          <EmptyState
            text={`No annual diabetes education on record. Assign the course to any employee who administers insulin or provides diabetes-related care (${DIABETES_COURSE_CITATION}).`}
          />
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Annual Diabetes Patient Education designed to address the training requirements of{" "}
              {DIABETES_COURSE_CITATION}. Every annual completion is listed; each stays bound to the
              course version it was taken against.
            </p>
            {data.map((row) => (
              <div
                key={row.course_assignment_id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">
                    {row.completed_at ? formatDateForDisplay(row.completed_at) : "In progress"}
                    <span className="text-muted-foreground font-normal">
                      {" "}&middot; version {row.course_version}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.final_exam_score != null ? `Final exam ${row.final_exam_score}%` : "Exam not yet passed"}
                    {" · "}
                    {row.exam_attempts} attempt{row.exam_attempts === 1 ? "" : "s"}
                    {row.certificate_number ? ` · ${row.certificate_number}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.training_provider}
                    {row.provider_credential ? `, ${row.provider_credential}` : ""}
                    {row.renewal_due_at ? ` · renews ${formatDateForDisplay(row.renewal_due_at)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={row.is_current ? "default" : "secondary"}>
                    {row.is_current ? "Current" : row.completed_at ? "Expired" : "Incomplete"}
                  </Badge>
                  {row.certificate_slug && (
                    <Link
                      href={`/verify/${row.certificate_slug}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Verify <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
