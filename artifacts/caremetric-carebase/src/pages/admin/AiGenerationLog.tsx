import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useListCourseAiGenerations, useListResidentAssessmentAiGenerations } from "@/hooks/useCourseAiGenerations";
import { useAuth } from "@/lib/auth";
import { courseDetailPath } from "@/lib/courseRoutes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, Sparkles } from "lucide-react";

type StatusFilter = "all" | "pending" | "completed" | "failed";

type AiGenerationLogRow = {
  id: string;
  kind: string;
  subject: ReactNode;
  requestedBy: string;
  model: string;
  status: string;
  errorMessage: string | null;
  detail: ReactNode;
  createdAt: string;
};

// Mirrors AuditLog.tsx's getActionDisplay / NotificationDeliveries.tsx's
// getStatusDisplay color-map convention -- course_ai_generations.status
// (pending/completed/failed) doesn't line up with any of StatusBadge's
// existing type variants, so it's inlined here the same way.
function getStatusDisplay(status: string): { color: string; label: string } {
  switch (status.toLowerCase()) {
    case "completed":
      return { color: "bg-green-100 text-green-800", label: "Completed" };
    case "pending":
      return { color: "bg-amber-100 text-amber-800", label: "Pending" };
    case "failed":
      return { color: "bg-red-100 text-red-800", label: "Failed" };
    default:
      return { color: "bg-gray-100 text-gray-800", label: status };
  }
}

function getKindLabel(kind: string): string {
  if (kind === "create_training_plan") return "Create Training Plan";
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getTrainingPlanSummary(responseSummary: unknown): { planName?: string; courseCount?: number } {
  if (!responseSummary || typeof responseSummary !== "object") return {};
  const summary = responseSummary as { plan_name?: unknown; course_count?: unknown };
  return {
    planName: typeof summary.plan_name === "string" ? summary.plan_name : undefined,
    courseCount: typeof summary.course_count === "number" ? summary.course_count : undefined,
  };
}

export default function AiGenerationLog() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filters = { status: statusFilter !== "all" ? statusFilter : undefined };
  const { data: courseGenerationsData, isLoading: isLoadingCourseGenerations } = useListCourseAiGenerations(filters);
  const { data: residentAssessmentGenerationsData, isLoading: isLoadingResidentAssessmentGenerations } = useListResidentAssessmentAiGenerations(filters);
  const isLoading = isLoadingCourseGenerations || isLoadingResidentAssessmentGenerations;

  const generations: AiGenerationLogRow[] = [
    ...(courseGenerationsData ?? []).map((gen): AiGenerationLogRow => {
      const requesterName = gen.requester ? `${gen.requester.first_name} ${gen.requester.last_name}`.trim() : "Unknown";
      const planSummary = gen.kind === "create_training_plan" ? getTrainingPlanSummary(gen.response_summary) : {};
      return {
        id: `course:${gen.id}`,
        kind: getKindLabel(gen.kind),
        subject: gen.kind === "create_training_plan" ? (
          <Link href="/admin/training-plans" className="text-primary hover:underline font-medium">
            {planSummary.planName ?? "AI-generated training plan"}
            {planSummary.courseCount ? ` (${planSummary.courseCount} courses)` : ""}
          </Link>
        ) : gen.course_id ? (
          <Link href={courseDetailPath(gen.course_id, user?.role)} className="text-primary hover:underline font-medium">
            {gen.courses?.title ?? gen.course_id}
          </Link>
        ) : (
          <span className="text-muted-foreground">-- (not yet linked)</span>
        ),
        requestedBy: requesterName || "Unknown",
        model: gen.model,
        status: gen.status,
        errorMessage: gen.error_message,
        detail: gen.reviewed_at ? (
          <Badge className="bg-green-100 text-green-800 whitespace-nowrap" variant="outline">Reviewed</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Pending review</span>
        ),
        createdAt: gen.created_at,
      };
    }),
    ...(residentAssessmentGenerationsData ?? []).map((gen): AiGenerationLogRow => {
      const requesterName = gen.requester ? `${gen.requester.first_name} ${gen.requester.last_name}`.trim() : "Unknown";
      return {
        id: `resident-assessment:${gen.id}`,
        kind: "Resident Wellness Summary",
        subject: (
          <span className="font-medium">
            Assessment form {gen.resident_assessment_form_id.slice(0, 8)}
          </span>
        ),
        requestedBy: requesterName || "Unknown",
        model: gen.model,
        status: gen.status,
        errorMessage: gen.error_message,
        detail: <span className="text-xs text-muted-foreground">No PHI stored in audit row</span>,
        createdAt: gen.created_at,
      };
    }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">AI Generation Log</h1>
          <p className="text-muted-foreground">
            Every AI course-content and resident wellness-summary generation call across the platform.
          </p>
        </div>
        <Button asChild className="shadow-sm">
          <Link href="/admin/courses/new-ai">
            <Sparkles className="mr-2 h-4 w-4" /> Generate New AI Course
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle>All Generations</CardTitle>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : !generations.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Bot className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium text-muted-foreground">No AI generation calls found</p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                Try adjusting your filters, or check back after the next AI generation.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {generations.map((gen) => {
                  const { color, label } = getStatusDisplay(gen.status);
                  return (
                    <TableRow key={gen.id}>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap">{gen.kind}</Badge>
                      </TableCell>
                      <TableCell>{gen.subject}</TableCell>
                      <TableCell>{gen.requestedBy}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{gen.model}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center w-fit px-2 py-0.5 rounded text-xs font-medium ${color}`}>
                            {label}
                          </span>
                          {gen.errorMessage && (
                            <span className="text-xs text-destructive max-w-xs">{gen.errorMessage}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{gen.detail}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(gen.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
