import { Link } from "wouter";
import { ArrowLeft, Archive, BookOpen, Loader2, Pencil, Play, Sparkles, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canEnrollInCourse, type Course, type CourseVersion } from "@/hooks/useCourses";
import type { Role } from "@/lib/auth";
import { coursesListPath } from "@/lib/courseRoutes";
import { CourseStatusBadge } from "./components";

export function CourseOverviewSection({
  course,
  userRole,
  selectedVersion,
  effectiveOrgId,
  canTakeCourse,
  enrolling,
  onTakeCourse,
  canManage,
  onEditCourse,
  canUnpublishCourse,
  onUnpublishClick,
  feedbackSummary,
  feedbackLoading = false,
  feedbackError = false,
}: {
  course: Course;
  userRole: Role | undefined;
  selectedVersion: CourseVersion | undefined;
  effectiveOrgId: string | undefined;
  canTakeCourse: boolean;
  enrolling: boolean;
  onTakeCourse: () => void;
  canManage: boolean;
  onEditCourse: () => void;
  canUnpublishCourse: boolean;
  onUnpublishClick: () => void;
  feedbackSummary: { average: number | null; count: number };
  feedbackLoading?: boolean;
  feedbackError?: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={coursesListPath(userRole)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <BookOpen className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{course.title}</h1>
            <p className="text-muted-foreground">{course.category ?? "Uncategorized"}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <CourseStatusBadge status={course.status} />
              {course.organization_id === null ? (
                <Badge variant="outline" className="text-[10px] font-medium">System Catalog</Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] font-medium">Org Training</Badge>
              )}
              {selectedVersion?.ai_generated && (
                <Badge variant="outline" className="text-[10px] font-medium bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-50">
                  <Sparkles className="h-3 w-3 mr-1" /> AI-Generated
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {course.status === "published" && canEnrollInCourse(course, effectiveOrgId) && (
            <Button variant="outline" size="sm" onClick={onTakeCourse} disabled={enrolling || !canTakeCourse}>
              {enrolling ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
              {canTakeCourse ? "Start Training" : "Training Not Ready"}
            </Button>
          )}
          {canManage && (
            <Button variant="outline" size="sm" onClick={onEditCourse}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </Button>
          )}
          {canUnpublishCourse && (
            <Button variant="destructive" size="sm" onClick={onUnpublishClick}>
              <Archive className="mr-2 h-3.5 w-3.5" /> Unpublish
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Description</p>
            {course.description ? (
              <p className="text-sm whitespace-pre-wrap">{course.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No description on file.</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimated Duration</p>
            <p className="text-sm">{course.estimated_duration_minutes ? `${course.estimated_duration_minutes} minutes` : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Employee Rating</p>
            {feedbackLoading ? (
              <p className="text-sm text-muted-foreground">Loading ratings…</p>
            ) : feedbackError ? (
              <p className="text-sm text-destructive">Couldn't load ratings.</p>
            ) : feedbackSummary.count > 0 ? (
              <p className="text-sm flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                {feedbackSummary.average} out of 5
                <span className="text-muted-foreground">
                  ({feedbackSummary.count} rating{feedbackSummary.count === 1 ? "" : "s"})
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No ratings yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
