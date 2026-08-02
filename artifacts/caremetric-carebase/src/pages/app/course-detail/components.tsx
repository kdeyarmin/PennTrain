import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen, FileText, Video, File as FileIcon, ListChecks, Layers,
  type LucideIcon,
} from "lucide-react";
import { useGetQuizByBlockId } from "@/hooks/useQuizzes";
import { useCourseVideoUrl } from "@/hooks/useCourseVideoUrl";
import type { Role } from "@/lib/auth";
import { quizBuilderPath } from "@/lib/courseRoutes";

export function CourseVideoPreview({ src }: { src: string }) {
  const resolved = useCourseVideoUrl(src);
  if (resolved.isLoading) return <Skeleton className="aspect-video w-full" />;
  if (!resolved.url) return <p className="p-3 text-sm text-destructive">Video unavailable: {resolved.error}</p>;
  return <video className="aspect-video w-full bg-black" src={resolved.url} controls />;
}

export function CourseStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  const className =
    status === "published" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "archived" ? "bg-muted text-muted-foreground hover:bg-muted/80"
    : "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  return <Badge className={className} variant="outline">{label}</Badge>;
}

export function VersionStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  const className = status === "published"
    ? "bg-success text-success-foreground hover:bg-success/80"
    : "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  return <Badge className={className} variant="outline">{label}</Badge>;
}

export const BLOCK_TYPE_META: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  text: { label: "Text", icon: FileText, className: "bg-secondary text-secondary-foreground" },
  video: { label: "Video", icon: Video, className: "bg-info text-info-foreground" },
  pdf: { label: "PDF", icon: FileIcon, className: "bg-muted text-muted-foreground" },
  scorm: { label: "SCORM", icon: BookOpen, className: "bg-muted text-muted-foreground" },
  quiz: { label: "Quiz", icon: ListChecks, className: "bg-warning text-warning-foreground" },
};

export function BlockTypeBadge({ blockType }: { blockType: string }) {
  const meta = BLOCK_TYPE_META[blockType] ?? { label: blockType, icon: Layers, className: "bg-secondary text-secondary-foreground" };
  const Icon = meta.icon;
  return (
    <Badge className={meta.className} variant="outline">
      <Icon className="h-3 w-3 mr-1" /> {meta.label}
    </Badge>
  );
}

export function QuizBlockSummary({
  blockId,
  onConfigure,
  canManage,
  role,
}: {
  blockId: string;
  onConfigure: () => void;
  canManage: boolean;
  role: Role | undefined;
}) {
  const { data: quiz, isLoading, isError } = useGetQuizByBlockId(blockId);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading quiz…</p>;

  if (isError || !quiz) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground italic">No quiz configured yet for this block.</p>
        {canManage && (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onConfigure}>
            Configure quiz
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <p className="text-xs text-muted-foreground">
        "{quiz.title}" — passing score {quiz.passing_score_percent}%
        {quiz.max_attempts ? `, max ${quiz.max_attempts} attempt${quiz.max_attempts === 1 ? "" : "s"}` : ""}
      </p>
      {canManage && (
        <Link href={quizBuilderPath(quiz.id, role)} className="text-xs font-medium text-primary hover:underline">
          Manage Questions
        </Link>
      )}
    </div>
  );
}
