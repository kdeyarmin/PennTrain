import { useState } from "react";
import { Link } from "wouter";
import { useListCourseAiGenerations } from "@/hooks/useCourseAiGenerations";
import { useAuth } from "@/lib/auth";
import { courseDetailPath } from "@/lib/courseRoutes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, Sparkles } from "lucide-react";

type StatusFilter = "all" | "pending" | "completed" | "failed";

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
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AiGenerationLog() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: generationsData, isLoading } = useListCourseAiGenerations({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });
  const generations = generationsData ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">AI Generation Log</h1>
          <p className="text-muted-foreground">
            Every AI course-curriculum and avatar-video generation call across the platform.
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
                Try adjusting your filters, or check back after the next AI course generation.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {generations.map((gen) => {
                  const { color, label } = getStatusDisplay(gen.status);
                  const requesterName = gen.requester
                    ? `${gen.requester.first_name} ${gen.requester.last_name}`.trim()
                    : "Unknown";
                  return (
                    <TableRow key={gen.id}>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap">{getKindLabel(gen.kind)}</Badge>
                      </TableCell>
                      <TableCell>
                        {gen.course_id ? (
                          <Link
                            href={courseDetailPath(gen.course_id, user?.role)}
                            className="text-primary hover:underline font-medium"
                          >
                            {gen.courses?.title ?? gen.course_id}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-- (not yet linked)</span>
                        )}
                      </TableCell>
                      <TableCell>{requesterName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{gen.model}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center w-fit px-2 py-0.5 rounded text-xs font-medium ${color}`}>
                            {label}
                          </span>
                          {gen.error_message && (
                            <span className="text-xs text-destructive max-w-xs">{gen.error_message}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {gen.reviewed_at ? (
                          <Badge className="bg-green-100 text-green-800 whitespace-nowrap" variant="outline">Reviewed</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Pending review</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(gen.created_at).toLocaleString()}
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
