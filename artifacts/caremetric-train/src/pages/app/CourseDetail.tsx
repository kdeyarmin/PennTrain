<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
=======
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useParams, Link, useLocation } from "wouter";
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, BookOpen, Pencil, Plus, Rocket, FileText, Video, File as FileIcon,
  ListChecks, Trash2, Lock, Layers, Sparkles, RefreshCw, type LucideIcon,
} from "lucide-react";
import {
  useGetCourse, useUpdateCourse,
  useListCourseVersions, useCreateCourseVersion, useUpdateCourseVersion,
  useListCourseBlocks, useCreateCourseBlock, useDeleteCourseBlock,
  type CourseVersion, type CourseBlock, type CourseBlockInsert,
} from "@/hooks/useCourses";
import { useGetQuizByBlockId, useCreateQuiz } from "@/hooks/useQuizzes";
import { useListHeygenOptions, useGenerateCourseVideo, useCheckCourseVideoStatus } from "@/hooks/useCourseVideoGeneration";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
=======
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, ArrowUp, ArrowDown, BookOpen, Pencil, Plus, Rocket, FileText, Video, File as FileIcon,
  ListChecks, Trash2, Lock, Layers, Sparkles, RefreshCw, Star, Wand2, Play, Loader2, Upload,
  Eye, CheckCircle2, CircleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  useGetCourse, useUpdateCourse,
  useListCourseVersions, useCreateCourseVersion, useCloneCourseVersion, usePublishCourseVersion,
  useListCourseBlocks, useCreateCourseBlock, useUpdateCourseBlock, useDeleteCourseBlock,
  canEnrollInCourse, getCourseVersionPublishIssues, isCourseVersionLearnerReady, useCourseVersionPublishIssues,
  type CourseVersion, type CourseBlock, type CourseBlockInsert,
} from "@/hooks/useCourses";
import { useSelfEnrollCourse } from "@/hooks/useCourseAssignments";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useGetQuizByBlockId, useCreateQuiz } from "@/hooks/useQuizzes";
import { useListCourseFeedback, summarizeCourseFeedback } from "@/hooks/useCourseFeedback";
import {
  useListHeygenOptions, useGenerateCourseVideo, useCheckCourseVideoStatus, useAutoCheckVideoStatuses,
} from "@/hooks/useCourseVideoGeneration";
import { useRegenerateCourseBlock, useListCourseAiGenerations, useMarkAiGenerationReviewed } from "@/hooks/useAiCourseGeneration";
import { useListDocuments, useUploadDocument, type TrainingDocument } from "@/hooks/useDocuments";
import { useListFacilities } from "@/hooks/useFacilities";
import { useAuth, type Role } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { coursesListPath, quizBuilderPath } from "@/lib/courseRoutes";
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx

interface CourseFormState {
  title: string;
  description: string;
  category: string;
  status: string;
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
}

=======
  trainingTypeId: string;
}

const NO_TRAINING_TYPE = "none";
const NO_DOCUMENT = "none";

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
interface BlockFormState {
  block_type: "text" | "video" | "pdf" | "scorm" | "quiz";
  title: string;
  textContent: string;
  videoUrl: string;
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
  videoTranscript: string;
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
  documentId: string;
}

const EMPTY_BLOCK_FORM: BlockFormState = {
  block_type: "text",
  title: "",
  textContent: "",
  videoUrl: "",
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
  documentId: "",
};

=======
  videoTranscript: "",
  documentId: "",
};

function blockName(block: Pick<CourseBlock, "title" | "sort_order">) {
  return block.title?.trim() || `Block ${block.sort_order + 1}`;
}

function textBodyContent(block: Pick<CourseBlock, "body">) {
  const body = block.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const content = (body as { content?: unknown }).content;
  return typeof content === "string" ? content.trim() : "";
}

function videoTranscriptContent(block: Pick<CourseBlock, "body">) {
  const body = block.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const { transcript, script } = body as { transcript?: unknown; script?: unknown };
  if (typeof transcript === "string" && transcript.trim()) return transcript.trim();
  if (typeof script === "string" && script.trim()) return script.trim();
  return "";
}

function documentDisplayName(document: Pick<TrainingDocument, "file_name" | "storage_path"> | undefined) {
  if (!document) return "";
  return document.file_name || document.storage_path.split("/").pop() || "Attached document";
}

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
interface QuizFormState {
  title: string;
  passingScore: string;
  maxAttempts: string;
}

function CourseStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  const className =
    status === "published" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "archived" ? "bg-muted text-muted-foreground hover:bg-muted/80"
    : "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  return <Badge className={className} variant="outline">{label}</Badge>;
}

function VersionStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  const className = status === "published"
    ? "bg-success text-success-foreground hover:bg-success/80"
    : "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  return <Badge className={className} variant="outline">{label}</Badge>;
}

const BLOCK_TYPE_META: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  text: { label: "Text", icon: FileText, className: "bg-secondary text-secondary-foreground" },
  video: { label: "Video", icon: Video, className: "bg-info text-info-foreground" },
  pdf: { label: "PDF", icon: FileIcon, className: "bg-muted text-muted-foreground" },
  scorm: { label: "SCORM", icon: BookOpen, className: "bg-muted text-muted-foreground" },
  quiz: { label: "Quiz", icon: ListChecks, className: "bg-warning text-warning-foreground" },
};

function BlockTypeBadge({ blockType }: { blockType: string }) {
  const meta = BLOCK_TYPE_META[blockType] ?? { label: blockType, icon: Layers, className: "bg-secondary text-secondary-foreground" };
  const Icon = meta.icon;
  return (
    <Badge className={meta.className} variant="outline">
      <Icon className="h-3 w-3 mr-1" /> {meta.label}
    </Badge>
  );
}

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
function QuizBlockSummary({ blockId, onConfigure }: { blockId: string; onConfigure: () => void }) {
=======
function QuizBlockSummary({
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
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
  const { data: quiz, isLoading, isError } = useGetQuizByBlockId(blockId);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading quiz…</p>;

  if (isError || !quiz) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground italic">No quiz configured yet for this block.</p>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onConfigure}>
          Configure quiz
        </Button>
=======
        {canManage && (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onConfigure}>
            Configure quiz
          </Button>
        )}
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
      </div>
    );
  }

  return (
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
    <p className="text-xs text-muted-foreground">
      "{quiz.title}" — passing score {quiz.passing_score_percent}%
      {quiz.max_attempts ? `, max ${quiz.max_attempts} attempt${quiz.max_attempts === 1 ? "" : "s"}` : ""}
    </p>
=======
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
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
  );
}

export default function CourseDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx

  const canManage = user?.role === "org_admin" || user?.role === "trainer";

  const { data: course, isLoading: courseLoading } = useGetCourse(id);
=======
  const [, navigate] = useLocation();

  const canManage = user?.role === "platform_admin";

  const { data: course, isLoading: courseLoading } = useGetCourse(id);
  // Only actually matters for platform_admin: courses_select RLS lets that role open any
  // organization's course (see canEnrollInCourse's own comment), but self_enroll_course rejects
  // enrolling in one that isn't system-catalog or the caller's own org -- every other role can
  // only ever reach a course RLS already scoped to their own org/system-catalog, so this is a
  // no-op for them.
  const { data: employee } = useGetEmployeeByProfileId(user?.id);
  // Prefer the employees row org when it exists; fall back to the profile org so that
  // org_admin/auditor who haven't self-enrolled yet (no employees row) still see the
  // "Take This Course" button for their org's published courses.
  const effectiveOrgId = employee?.organization_id ?? user?.organizationId ?? undefined;

  const { mutate: selfEnroll, isPending: enrolling } = useSelfEnrollCourse();
  const handleTakeCourse = () => {
    if (!course) return;
    if (!canTakeCourse) {
      toast({
        title: "Course is not ready yet",
        description: "A published, reviewed course version is required before learners can start.",
        variant: "destructive",
      });
      return;
    }
    selfEnroll(course.id, {
      onSuccess: assignmentId => navigate(`/me/courses/${assignmentId}`),
      onError: (e: Error) => toast({ title: "Couldn't start course", description: e.message, variant: "destructive" }),
    });
  };

  const { data: courseFeedback } = useListCourseFeedback({ courseId: id });
  const feedbackSummary = summarizeCourseFeedback(courseFeedback);
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
  const { data: versions, isLoading: versionsLoading } = useListCourseVersions(id);

  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>(undefined);

  // Default the selected version to the course's current_version_id if it's
  // among the loaded versions, otherwise the most recently created version.
  useEffect(() => {
    if (selectedVersionId || !versions || versions.length === 0) return;
    const current = course?.current_version_id;
    if (current && versions.some(v => v.id === current)) {
      setSelectedVersionId(current);
    } else {
      setSelectedVersionId(versions[versions.length - 1].id);
    }
  }, [course, versions, selectedVersionId]);

  const selectedVersion: CourseVersion | undefined = versions?.find(v => v.id === selectedVersionId);
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
  const isVersionLocked = selectedVersion?.status === "published";

  const { data: blocks, isLoading: blocksLoading } = useListCourseBlocks(selectedVersion?.id);

  // --- Course metadata edit ---
  const [showEditCourse, setShowEditCourse] = useState(false);
  const [courseForm, setCourseForm] = useState<CourseFormState>({ title: "", description: "", category: "", status: "draft" });
  const { mutate: updateCourse, isPending: savingCourse } = useUpdateCourse();
=======
  const currentVersion = useMemo(
    () => versions?.find(v => v.id === course?.current_version_id),
    [versions, course?.current_version_id],
  );
  const isVersionLocked = selectedVersion?.status === "published";
  const canTakeCourse =
    !!course
    && course.status === "published"
    && canEnrollInCourse(course, effectiveOrgId)
    && isCourseVersionLearnerReady(currentVersion);

  const { data: blocks, isLoading: blocksLoading } = useListCourseBlocks(selectedVersion?.id);
  const courseDocumentPrefix = course ? `${course.organization_id ?? "system"}/${course.id}/` : undefined;
  const { data: courseDocuments, isLoading: courseDocumentsLoading } = useListDocuments(
    courseDocumentPrefix
      ? { storageBucket: "course-documents", storagePathPrefix: courseDocumentPrefix }
      : {},
    !!courseDocumentPrefix,
  );
  const { data: facilities } = useListFacilities(
    course?.organization_id ? { organizationId: course.organization_id } : {},
    canManage && !!course,
  );
  const uploadCourseDocument = useUploadDocument();
  const courseDocumentInputRef = useRef<HTMLInputElement | null>(null);
  const courseDocumentById = useMemo(
    () => new Map((courseDocuments ?? []).map(document => [document.id, document])),
    [courseDocuments],
  );
  const courseDocumentUploadFacility = useMemo(
    () => facilities?.find(f => !course?.organization_id || f.organization_id === course.organization_id) ?? facilities?.[0],
    [facilities, course?.organization_id],
  );
  const { data: publishIssues, isLoading: publishIssuesLoading } = useCourseVersionPublishIssues(
    selectedVersion?.id,
    !!selectedVersion && canManage,
  );

  // Client-side backstop that keeps in-flight HeyGen video statuses fresh without requiring
  // the manual "check status" button (which stays below as an instant fallback).
  useAutoCheckVideoStatuses(blocks);

  const [showStudentPreview, setShowStudentPreview] = useState(false);
  const [studentPreviewChecked, setStudentPreviewChecked] = useState(false);
  useEffect(() => { setStudentPreviewChecked(false); }, [selectedVersionId]);

  const prePublishChecks = useMemo(() => {
    const versionBlocks = blocks ?? [];
    const lowerIssues = (publishIssues ?? []).map(issue => issue.toLowerCase());
    const hasIssue = (needles: string[]) => lowerIssues.some(issue => needles.some(needle => issue.includes(needle)));
    const textBlocks = versionBlocks.filter(block => block.block_type === "text");
    const videoBlocks = versionBlocks.filter(block => block.block_type === "video");
    const documentBlocks = versionBlocks.filter(block => block.block_type === "pdf" || block.block_type === "scorm");

    return [
      {
        label: "Course content is present",
        passed: versionBlocks.length > 0 && !hasIssue(["content block"]),
        detail: versionBlocks.length > 0 ? `${versionBlocks.length} block${versionBlocks.length === 1 ? "" : "s"} in this version.` : "Add at least one block.",
      },
      {
        label: "Lesson text is readable",
        passed: textBlocks.length === 0 || textBlocks.every(block => !!textBodyContent(block)),
        detail: textBlocks.length === 0 ? "No text blocks in this version." : "Text blocks have saved content.",
      },
      {
        label: "Videos are ready with captions or transcript",
        passed: videoBlocks.length === 0 || (videoBlocks.every(block => !!block.video_url) && videoBlocks.every(block => !!videoTranscriptContent(block))),
        detail: videoBlocks.length === 0
          ? "No video blocks in this version."
          : "Every video should have a finished URL and a script or transcript.",
      },
      {
        label: "PDF and SCORM resources are attached",
        passed: documentBlocks.length === 0 || documentBlocks.every(block => !!block.document_id),
        detail: documentBlocks.length === 0 ? "No document blocks in this version." : "Document blocks point to uploaded files.",
      },
      {
        label: "Quiz questions and answers pass validation",
        passed: !publishIssuesLoading && !hasIssue(["configure the quiz", "add at least one question", "add at least two answer choices", "mark at least one correct answer", "single-choice questions can have only one correct answer"]),
        detail: publishIssuesLoading ? "Checking quiz setup..." : "Quiz blocks need questions, answer choices, and a valid answer key.",
      },
      {
        label: "Student preview and mobile layout reviewed",
        passed: studentPreviewChecked,
        detail: "Open the student preview and confirm the content is easy to take on a learner-sized screen.",
      },
    ];
  }, [blocks, publishIssues, publishIssuesLoading, studentPreviewChecked]);

  // --- Course metadata edit ---
  const [showEditCourse, setShowEditCourse] = useState(false);
  const [courseForm, setCourseForm] = useState<CourseFormState>({ title: "", description: "", category: "", status: "draft", trainingTypeId: NO_TRAINING_TYPE });
  const { mutate: updateCourse, isPending: savingCourse } = useUpdateCourse();
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx

  const openEditCourse = () => {
    if (!course) return;
    setCourseForm({
      title: course.title,
      description: course.description ?? "",
      category: course.category ?? "",
      status: course.status,
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
      trainingTypeId: course.training_type_id ?? NO_TRAINING_TYPE,
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
    });
    setShowEditCourse(true);
  };

  const handleSaveCourse = () => {
    if (!course) return;
    if (!courseForm.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    updateCourse(
      {
        id: course.id,
        title: courseForm.title.trim(),
        description: courseForm.description || null,
        category: courseForm.category || null,
        status: courseForm.status,
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
        training_type_id: courseForm.trainingTypeId === NO_TRAINING_TYPE ? null : courseForm.trainingTypeId,
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
      },
      {
        onSuccess: () => { toast({ title: "Course updated" }); setShowEditCourse(false); },
        onError: (e: Error) => toast({ title: "Failed to update course", description: e.message, variant: "destructive" }),
      },
    );
  };

  // --- New version ---
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [newVersionTitle, setNewVersionTitle] = useState("");
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
  const { mutate: createVersion, isPending: creatingVersion } = useCreateCourseVersion();
=======
  const { mutate: cloneVersion, isPending: cloningVersion } = useCloneCourseVersion();
  const { mutate: createBlankVersion, isPending: creatingBlankVersion } = useCreateCourseVersion();
  const creatingVersion = cloningVersion || creatingBlankVersion;
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx

  const nextVersionNumber = (versions?.reduce((max, v) => Math.max(max, v.version_number), 0) ?? 0) + 1;

  const openNewVersion = () => {
    if (!course) return;
    setNewVersionTitle(`${course.title} — v${nextVersionNumber}`);
    setShowNewVersion(true);
  };

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
  const handleCreateVersion = () => {
    if (!course) return;
    createVersion(
      {
        course_id: course.id,
        organization_id: course.organization_id,
        version_number: nextVersionNumber,
        title: newVersionTitle.trim() || `Version ${nextVersionNumber}`,
      },
      {
        onSuccess: (data) => {
          toast({ title: "Draft version created" });
=======
  // Clones whichever version is currently selected (defaults to the course's published version,
  // see the selectedVersionId effect above) rather than starting blank -- fixing one typo no
  // longer means manually rebuilding every block/quiz/question/answer from zero. A brand-new
  // course has no version to clone from (selectedVersion never resolves -- see that effect's own
  // "no versions" branch), so this falls back to the original blank-insert path for exactly that
  // case; every other course always has at least one version by the time this dialog is reachable.
  const handleCreateVersion = () => {
    if (!course) return;
    const title = newVersionTitle.trim() || `Version ${nextVersionNumber}`;
    if (!selectedVersion) {
      createBlankVersion(
        { course_id: course.id, organization_id: course.organization_id, version_number: nextVersionNumber, title },
        {
          onSuccess: (data) => {
            toast({ title: "Draft version created", variant: "success" });
            setShowNewVersion(false);
            setSelectedVersionId(data.id);
          },
          onError: (e: Error) => toast({ title: "Failed to create version", description: e.message, variant: "destructive" }),
        },
      );
      return;
    }
    cloneVersion(
      {
        sourceVersionId: selectedVersion.id,
        courseId: course.id,
        organizationId: course.organization_id,
        versionNumber: nextVersionNumber,
        title,
      },
      {
        onSuccess: (data) => {
          toast({ title: "Draft version created", description: `Copied content from v${selectedVersion.version_number}.`, variant: "success" });
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
          setShowNewVersion(false);
          setSelectedVersionId(data.id);
        },
        onError: (e: Error) => toast({ title: "Failed to create version", description: e.message, variant: "destructive" }),
      },
    );
  };

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
  // --- Publish a version (two mutations: version.status + course.current_version_id) ---
  const { mutateAsync: publishVersionAsync } = useUpdateCourseVersion();
  const { mutateAsync: setCurrentVersionAsync } = useUpdateCourse();
=======
  // --- Publish a version (database RPC validates readiness and sets course.current_version_id) ---
  const { mutateAsync: publishVersionAsync } = usePublishCourseVersion();
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
  const [publishingVersionId, setPublishingVersionId] = useState<string | null>(null);

  const handlePublish = async (version: CourseVersion) => {
    if (!course) return;
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
    setPublishingVersionId(version.id);
    const [versionResult, courseResult] = await Promise.allSettled([
      publishVersionAsync({ id: version.id, status: "published", published_at: new Date().toISOString() }),
      setCurrentVersionAsync({ id: course.id, current_version_id: version.id }),
    ]);
    setPublishingVersionId(null);

    const versionFailed = versionResult.status === "rejected";
    const courseFailed = courseResult.status === "rejected";

    if (versionFailed && courseFailed) {
      toast({
        title: "Failed to publish version",
        description: `Both updates failed. Version: ${(versionResult.reason as Error)?.message}. Course: ${(courseResult.reason as Error)?.message}`,
        variant: "destructive",
      });
    } else if (versionFailed) {
      toast({
        title: "Partially published",
        description: `The course now points at this version, but marking it "published" failed: ${(versionResult.reason as Error)?.message}. The version is still a draft -- retry or fix and try again.`,
        variant: "destructive",
      });
    } else if (courseFailed) {
      toast({
        title: "Partially published",
        description: `The version was marked "published", but setting it as the course's current version failed: ${(courseResult.reason as Error)?.message}. Retry to finish publishing.`,
        variant: "destructive",
      });
    } else {
      toast({ title: "Version published" });
=======
    if (version.id !== selectedVersionId || !studentPreviewChecked) {
      setSelectedVersionId(version.id);
      toast({
        title: "Review the student preview first",
        description: "Open the preview, check the learner experience, then mark the checklist item before publishing.",
        variant: "destructive",
      });
      return;
    }
    const failedChecks = prePublishChecks.filter(check => !check.passed);
    if (failedChecks.length > 0) {
      toast({
        title: "Complete the pre-publish checklist",
        description: failedChecks.slice(0, 3).map(check => check.label).join(", "),
        variant: "destructive",
      });
      return;
    }
    setPublishingVersionId(version.id);
    try {
      const readinessIssues = await getCourseVersionPublishIssues(version.id);
      if (readinessIssues.length > 0) {
        toast({
          title: "Version is not ready to publish",
          description: readinessIssues.slice(0, 4).join(" "),
          variant: "destructive",
        });
        return;
      }
      await publishVersionAsync(version.id);
      toast({ title: "Version published" });
    } catch (e) {
      toast({
        title: "Failed to publish version",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setPublishingVersionId(null);
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
    }
  };

  // --- Blocks ---
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [blockForm, setBlockForm] = useState<BlockFormState>(EMPTY_BLOCK_FORM);
  const { mutate: createBlock, isPending: creatingBlock } = useCreateCourseBlock();
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
  const { mutate: deleteBlock, isPending: deletingBlock } = useDeleteCourseBlock();
  const [blockPendingDelete, setBlockPendingDelete] = useState<CourseBlock | null>(null);

=======
  const { mutateAsync: updateBlockAsync } = useUpdateCourseBlock();
  const { mutate: deleteBlock, isPending: deletingBlock } = useDeleteCourseBlock();
  const [blockPendingDelete, setBlockPendingDelete] = useState<CourseBlock | null>(null);

  // Reorders a block by swapping its sort_order with the adjacent block -- mirrors
  // CompetencyTemplates.tsx's ManageItemsDialog.handleMove (two concurrent mutateAsync calls,
  // with a busy-state guard so a second click can't race an in-flight swap).
  const [reorderingBlocks, setReorderingBlocks] = useState(false);

  const handleMoveBlock = async (index: number, direction: -1 | 1) => {
    if (!blocks) return;
    const target = blocks[index];
    const neighbor = blocks[index + direction];
    if (!target || !neighbor) return;
    setReorderingBlocks(true);
    try {
      await Promise.all([
        updateBlockAsync({ id: target.id, sort_order: neighbor.sort_order }),
        updateBlockAsync({ id: neighbor.id, sort_order: target.sort_order }),
      ]);
    } catch (e) {
      toast({ title: "Failed to reorder blocks", description: (e as Error).message, variant: "destructive" });
    } finally {
      setReorderingBlocks(false);
    }
  };

  // Guards the Add Block / Generate Video dialogs (both textarea-heavy) against silently losing
  // typed content on an accidental outside-click or Escape: closing either via Dialog's
  // onOpenChange (not the explicit Cancel/Save buttons, which bypass this and close directly)
  // checks whether the form still matches its empty starting state, and if not, opens this shared
  // "discard changes?" AlertDialog instead of closing immediately. See
  // handleRequestCloseAddBlock/handleRequestCloseVideoGen and handleConfirmDiscard below.
  const [discardConfirm, setDiscardConfirm] = useState<null | "block" | "video">(null);

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
  const openAddBlock = () => {
    setBlockForm(EMPTY_BLOCK_FORM);
    setShowAddBlock(true);
  };

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
  const handleCourseDocumentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !course || !courseDocumentPrefix) return;

    if (!courseDocumentUploadFacility) {
      toast({
        title: "No facility available for document ownership",
        description: "Create or select a facility before uploading a course document.",
        variant: "destructive",
      });
      return;
    }

    try {
      const document = await uploadCourseDocument.mutateAsync({
        file,
        bucket: "course-documents",
        organizationId: courseDocumentUploadFacility.organization_id,
        facilityId: courseDocumentUploadFacility.id,
        documentType: "other",
        storagePrefix: courseDocumentPrefix,
      });
      setBlockForm(f => ({ ...f, documentId: document.id }));
      toast({ title: "Document uploaded", description: `${document.file_name} is attached to this block.` });
    } catch (e) {
      toast({ title: "Failed to upload document", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleRequestCloseAddBlock = () => {
    if (JSON.stringify(blockForm) !== JSON.stringify(EMPTY_BLOCK_FORM)) {
      setDiscardConfirm("block");
    } else {
      setShowAddBlock(false);
    }
  };

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
  const handleAddBlock = () => {
    if (!course || !selectedVersion) return;
    const nextSort = (blocks?.reduce((max, b) => Math.max(max, b.sort_order), -1) ?? -1) + 1;
    const payload: CourseBlockInsert = {
      course_version_id: selectedVersion.id,
      organization_id: course.organization_id,
      block_type: blockForm.block_type,
      sort_order: nextSort,
      title: blockForm.title || null,
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
      body: blockForm.block_type === "text" ? { content: blockForm.textContent } : null,
=======
      body: blockForm.block_type === "text"
        ? { content: blockForm.textContent }
        : blockForm.block_type === "video" && blockForm.videoTranscript.trim()
          ? { transcript: blockForm.videoTranscript.trim() }
          : null,
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
      video_url: blockForm.block_type === "video" ? (blockForm.videoUrl || null) : null,
      document_id: (blockForm.block_type === "pdf" || blockForm.block_type === "scorm") ? (blockForm.documentId || null) : null,
    };
    createBlock(payload, {
      onSuccess: (newBlock) => {
        toast({ title: "Block added" });
        setShowAddBlock(false);
        setBlockForm(EMPTY_BLOCK_FORM);
        if (newBlock.block_type === "quiz") {
          openQuizPrompt(newBlock);
        }
      },
      onError: (e: Error) => toast({ title: "Failed to add block", description: e.message, variant: "destructive" }),
    });
  };

  const handleDeleteBlock = () => {
    if (!blockPendingDelete || !selectedVersion) return;
    deleteBlock(
      { id: blockPendingDelete.id, courseVersionId: selectedVersion.id },
      {
        onSuccess: () => { toast({ title: "Block removed" }); setBlockPendingDelete(null); },
        onError: (e: Error) => toast({ title: "Failed to remove block", description: e.message, variant: "destructive" }),
      },
    );
  };

  // --- Quiz creation prompt (after adding a 'quiz' block, or later via "Configure quiz") ---
  const [quizPromptBlock, setQuizPromptBlock] = useState<CourseBlock | null>(null);
  const [quizForm, setQuizForm] = useState<QuizFormState>({ title: "", passingScore: "80", maxAttempts: "" });
  const { mutate: createQuiz, isPending: creatingQuiz } = useCreateQuiz();

  const openQuizPrompt = (block: CourseBlock) => {
    setQuizPromptBlock(block);
    setQuizForm({ title: block.title ?? "New Quiz", passingScore: "80", maxAttempts: "" });
  };

  const handleCreateQuiz = () => {
    if (!quizPromptBlock || !course) return;
    if (!quizForm.title.trim()) {
      toast({ title: "Quiz title is required", variant: "destructive" });
      return;
    }
    const passingScore = Number(quizForm.passingScore);
    createQuiz(
      {
        course_block_id: quizPromptBlock.id,
        organization_id: course.organization_id,
        title: quizForm.title.trim(),
        passing_score_percent: Number.isFinite(passingScore) ? passingScore : 80,
        max_attempts: quizForm.maxAttempts.trim() ? Number(quizForm.maxAttempts) : null,
      },
      {
        onSuccess: () => { toast({ title: "Quiz created" }); setQuizPromptBlock(null); },
        onError: (e: Error) => toast({ title: "Failed to create quiz", description: e.message, variant: "destructive" }),
      },
    );
  };

  // --- AI avatar video generation (HeyGen), for an existing 'video' block ---
  const [videoGenBlock, setVideoGenBlock] = useState<CourseBlock | null>(null);
  const [videoGenForm, setVideoGenForm] = useState({ avatarId: "", voiceId: "", script: "" });
  const { data: heygenOptions, isLoading: heygenOptionsLoading } = useListHeygenOptions(!!videoGenBlock);
  const { mutate: generateVideo, isPending: generatingVideo } = useGenerateCourseVideo();
  const { mutate: checkVideoStatus, isPending: checkingVideoStatus } = useCheckCourseVideoStatus();

  const openVideoGen = (block: CourseBlock) => {
    setVideoGenBlock(block);
    setVideoGenForm({ avatarId: "", voiceId: "", script: "" });
  };

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
  const handleRequestCloseVideoGen = () => {
    if (videoGenForm.avatarId || videoGenForm.voiceId || videoGenForm.script.trim()) {
      setDiscardConfirm("video");
    } else {
      setVideoGenBlock(null);
    }
  };

  // Confirms discarding whichever dialog (Add Block or Generate Video) triggered
  // discardConfirm above, resetting that dialog's form back to empty.
  const handleConfirmDiscard = () => {
    if (discardConfirm === "block") {
      setShowAddBlock(false);
      setBlockForm(EMPTY_BLOCK_FORM);
    } else if (discardConfirm === "video") {
      setVideoGenBlock(null);
      setVideoGenForm({ avatarId: "", voiceId: "", script: "" });
    }
    setDiscardConfirm(null);
  };

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
  const handleGenerateVideo = () => {
    if (!videoGenBlock) return;
    if (!videoGenForm.avatarId || !videoGenForm.voiceId || !videoGenForm.script.trim()) {
      toast({ title: "Avatar, voice, and script are all required", variant: "destructive" });
      return;
    }
    generateVideo(
      {
        courseBlockId: videoGenBlock.id,
        avatarId: videoGenForm.avatarId,
        voiceId: videoGenForm.voiceId,
        script: videoGenForm.script.trim(),
        title: videoGenBlock.title ?? undefined,
      },
      {
        onSuccess: () => {
          toast({ title: "Video generation started", description: "This typically takes a few minutes -- use the refresh action to check on it." });
          setVideoGenBlock(null);
        },
        onError: (e: Error) => toast({ title: "Failed to start video generation", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleCheckVideoStatus = (block: CourseBlock) => {
    checkVideoStatus(block.id, {
      onSuccess: (result) => {
        if (result.status === "completed") toast({ title: "Video ready" });
        else if (result.status === "failed") toast({ title: "Video generation failed", description: result.error, variant: "destructive" });
        else toast({ title: `Still generating (${result.status})` });
      },
      onError: (e: Error) => toast({ title: "Failed to check video status", description: e.message, variant: "destructive" }),
    });
  };

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
  // --- Bulk "Generate All Videos": one avatar/voice pick, applied to every video block in
  // this version that doesn't have a video yet, using each block's AI-authored body.script
  // as the narration. Blocks with no script (never AI-generated/authored) are skipped rather
  // than guessed at -- the admin has to add a script manually first. ---
  const eligibleVideoBlocks = (blocks ?? []).filter(b => b.block_type === "video" && !b.video_url);
  const eligibleVideoBlocksWithScript = eligibleVideoBlocks.filter(
    b => !!(b.body as { script?: string } | null)?.script?.trim(),
  );
  const eligibleVideoBlocksMissingScript = eligibleVideoBlocks.length - eligibleVideoBlocksWithScript.length;

  const [showBulkVideoGen, setShowBulkVideoGen] = useState(false);
  const [bulkVideoForm, setBulkVideoForm] = useState({ avatarId: "", voiceId: "" });
  const { data: bulkHeygenOptions, isLoading: bulkHeygenOptionsLoading } = useListHeygenOptions(showBulkVideoGen);
  const { mutateAsync: generateVideoAsync } = useGenerateCourseVideo();
  // Once set, the dialog shows the per-block progress list instead of the avatar/voice form.
  const [bulkGenBlockIds, setBulkGenBlockIds] = useState<string[] | null>(null);
  const [bulkGenSkippedCount, setBulkGenSkippedCount] = useState(0);
  const [bulkGenStartFailures, setBulkGenStartFailures] = useState<Set<string>>(new Set());
  const [bulkGenStarting, setBulkGenStarting] = useState(false);

  const openBulkVideoGen = () => {
    setBulkVideoForm({ avatarId: "", voiceId: "" });
    setBulkGenBlockIds(null);
    setBulkGenSkippedCount(0);
    setBulkGenStartFailures(new Set());
    setShowBulkVideoGen(true);
  };

  const closeBulkVideoGen = () => {
    setShowBulkVideoGen(false);
    setBulkGenBlockIds(null);
    setBulkGenSkippedCount(0);
    setBulkGenStartFailures(new Set());
  };

  const handleGenerateAllVideos = async () => {
    if (!bulkVideoForm.avatarId || !bulkVideoForm.voiceId) {
      toast({ title: "Avatar and voice are required", variant: "destructive" });
      return;
    }
    if (eligibleVideoBlocksWithScript.length === 0) return;

    setBulkGenSkippedCount(eligibleVideoBlocksMissingScript);
    setBulkGenBlockIds(eligibleVideoBlocksWithScript.map(b => b.id));
    setBulkGenStartFailures(new Set());
    setBulkGenStarting(true);

    const results = await Promise.allSettled(
      eligibleVideoBlocksWithScript.map(b =>
        generateVideoAsync({
          courseBlockId: b.id,
          avatarId: bulkVideoForm.avatarId,
          voiceId: bulkVideoForm.voiceId,
          script: ((b.body as { script?: string } | null)?.script ?? "").trim(),
          title: b.title ?? undefined,
        }),
      ),
    );
    setBulkGenStarting(false);

    const failedIds = new Set(
      eligibleVideoBlocksWithScript.filter((_, i) => results[i].status === "rejected").map(b => b.id),
    );
    setBulkGenStartFailures(failedIds);
    const succeeded = results.length - failedIds.size;
    toast({
      title: "Bulk video generation started",
      description: `${succeeded} of ${results.length} block${results.length === 1 ? "" : "s"} started successfully.`
        + (failedIds.size > 0 ? ` ${failedIds.size} failed to start.` : "")
        + " Status updates automatically as each one finishes.",
      variant: failedIds.size > 0 && succeeded === 0 ? "destructive" : undefined,
    });
  };

  type BulkVideoGenStatus = "queued" | "processing" | "completed" | "failed";

  const getBulkVideoGenStatus = (block: CourseBlock | undefined, blockId: string): BulkVideoGenStatus => {
    if (bulkGenStartFailures.has(blockId)) return "failed";
    if (!block) return "queued";
    if (block.video_url) return "completed";
    const heygenStatus = (block.body as { heygen?: { status?: string } } | null)?.heygen?.status;
    if (heygenStatus === "failed") return "failed";
    if (heygenStatus && heygenStatus !== "completed") return "processing";
    return "queued";
  };

  const BULK_STATUS_META: Record<BulkVideoGenStatus, { label: string; className: string }> = {
    queued: { label: "Queued", className: "bg-secondary text-secondary-foreground" },
    processing: { label: "Processing", className: "bg-info text-info-foreground" },
    completed: { label: "Completed", className: "bg-success text-success-foreground" },
    failed: { label: "Failed", className: "bg-destructive text-destructive-foreground" },
  };

  // --- Regenerate a content block with AI (any block type) ---
  const [regenerateBlock, setRegenerateBlock] = useState<CourseBlock | null>(null);
  const [regenerateFeedback, setRegenerateFeedback] = useState("");
  const { mutate: regenerateBlockMutate, isPending: regeneratingBlock } = useRegenerateCourseBlock();

  const openRegenerateBlock = (block: CourseBlock) => {
    setRegenerateBlock(block);
    setRegenerateFeedback("");
  };

  const handleRegenerateBlock = () => {
    if (!regenerateBlock || !selectedVersion) return;
    if (!regenerateFeedback.trim()) {
      toast({ title: "Feedback is required", description: "Tell the AI what to change so it has something to act on.", variant: "destructive" });
      return;
    }
    regenerateBlockMutate(
      { courseBlockId: regenerateBlock.id, courseVersionId: selectedVersion.id, feedback: regenerateFeedback.trim() },
      {
        onSuccess: () => { toast({ title: "Block regenerated" }); setRegenerateBlock(null); },
        onError: (e: Error) => toast({ title: "Failed to regenerate block", description: e.message, variant: "destructive" }),
      },
    );
  };

  // --- AI review gate: for versions drafted by the AI wizard, require an explicit
  // self-review acknowledgment before they can be published (the DB trigger from
  // Part 3 is the real enforcement; this is a UX courtesy pointing at the same rule). ---
  const [reviewChecked, setReviewChecked] = useState(false);
  useEffect(() => { setReviewChecked(false); }, [selectedVersionId]);

  const needsAiReview = !!selectedVersion?.ai_generated && !selectedVersion?.ai_reviewed_at;
  const { data: aiGenerations } = useListCourseAiGenerations(course?.id, needsAiReview && !!course?.id);
  const { mutate: markReviewed, isPending: markingReviewed } = useMarkAiGenerationReviewed();

  const handleMarkReviewed = () => {
    if (!selectedVersion || !user) return;
    const matchingGeneration = aiGenerations?.find(
      g => g.kind === "create_course" && g.course_version_id === selectedVersion.id,
    );
    markReviewed(
      { courseVersionId: selectedVersion.id, generationId: matchingGeneration?.id, reviewedBy: user.id },
      {
        onSuccess: (result) => {
          if (result.generationFailed) {
            toast({
              title: "Marked reviewed",
              description: "The version is reviewed, but updating the generation audit record failed -- not blocking, just noting it.",
            });
          } else {
            toast({ title: "Marked reviewed" });
          }
          setReviewChecked(false);
        },
        onError: (e: Error) => toast({ title: "Failed to mark as reviewed", description: e.message, variant: "destructive" }),
      },
    );
  };

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
  if (courseLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Course not found.</p>
        <Button asChild className="mt-4" variant="outline">
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
          <Link href="/app/courses">Back to Courses</Link>
=======
          <Link href={coursesListPath(user?.role)}>Back to Courses</Link>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
          <Link href="/app/courses">
=======
          <Link href={coursesListPath(user?.role)}>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
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
                <Badge variant="secondary" className="text-[10px] font-medium">Org Course</Badge>
              )}
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
            </div>
          </div>
        </div>
        {canManage && (
          <Button variant="outline" size="sm" onClick={openEditCourse}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
          </Button>
        )}
=======
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
            <Button variant="outline" size="sm" onClick={handleTakeCourse} disabled={enrolling || !canTakeCourse}>
              {enrolling ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
              {canTakeCourse ? "Take This Course" : "Course Not Ready"}
            </Button>
          )}
          {canManage && (
            <Button variant="outline" size="sm" onClick={openEditCourse}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </div>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
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
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
          <div>
            <p className="text-xs text-muted-foreground">Learner Rating</p>
            {feedbackSummary.count > 0 ? (
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
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>Versions</CardTitle>
            {canManage && (
              <Button size="sm" onClick={openNewVersion}>
                <Plus className="mr-2 h-3.5 w-3.5" /> New Version
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {versionsLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
            </div>
          ) : !versions || versions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No versions yet.</p>
              {canManage && (
                <p className="text-xs text-muted-foreground/70 mt-1">Create the first draft version to start authoring this course.</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {versions.map(v => (
                <div
                  key={v.id}
                  className={`flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${v.id === selectedVersionId ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}
                  onClick={() => setSelectedVersionId(v.id)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">v{v.version_number} — {v.title}</span>
                      <VersionStatusBadge status={v.status} />
                      {course.current_version_id === v.id && (
                        <Badge variant="outline" className="text-[10px] font-medium">Current</Badge>
                      )}
                    </div>
                    {v.published_at && (
                      <p className="text-xs text-muted-foreground mt-0.5">Published {new Date(v.published_at).toLocaleDateString()}</p>
                    )}
                  </div>
                  {canManage && v.status === "draft" && (
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={publishingVersionId === v.id}
                      onClick={(e) => { e.stopPropagation(); handlePublish(v); }}
                    >
                      <Rocket className="mr-2 h-3.5 w-3.5" />
                      {publishingVersionId === v.id ? "Publishing..." : "Publish"}
                    </Button>
=======
                    v.ai_generated && !v.ai_reviewed_at ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {/* Wrapping span, not the disabled Button itself, is the trigger --
                              disabled buttons have pointer-events:none and won't fire hover. */}
                          <span onClick={(e) => e.stopPropagation()} className="inline-block">
                            <Button size="sm" variant="outline" disabled>
                              <Rocket className="mr-2 h-3.5 w-3.5" /> Publish
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          AI-generated content must be reviewed before publishing -- see the review checklist below.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={publishingVersionId === v.id}
                        onClick={(e) => { e.stopPropagation(); handlePublish(v); }}
                      >
                        <Rocket className="mr-2 h-3.5 w-3.5" />
                        {publishingVersionId === v.id ? "Publishing..." : "Publish"}
                      </Button>
                    )
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
      {canManage && needsAiReview && (
        <Alert className="border-warning/40 bg-warning/10">
          <Sparkles className="h-4 w-4" />
          <AlertTitle>AI-generated content needs review</AlertTitle>
          <AlertDescription>
            <p className="mb-3">
              This version's content was drafted by AI and hasn't been reviewed yet. Read through each block below
              for accuracy before publishing -- AI-authored regulatory or policy content can be wrong or outdated.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ai-reviewed-checkbox"
                  checked={reviewChecked}
                  onCheckedChange={c => setReviewChecked(c === true)}
                />
                <Label htmlFor="ai-reviewed-checkbox" className="text-sm font-normal cursor-pointer">
                  I've reviewed this content for accuracy
                </Label>
              </div>
              <Button size="sm" disabled={!reviewChecked || markingReviewed} onClick={handleMarkReviewed}>
                {markingReviewed ? "Marking..." : "Mark Reviewed"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {canManage && selectedVersion && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle>Pre-Publish Checklist</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowStudentPreview(true)}
                disabled={!blocks || blocks.length === 0}
              >
                <Eye className="mr-2 h-3.5 w-3.5" /> Preview as Student
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {prePublishChecks.map(check => {
                const Icon = check.passed ? CheckCircle2 : CircleAlert;
                return (
                  <div key={check.label} className="flex items-start gap-2 rounded-md border p-3">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${check.passed ? "text-success" : "text-warning"}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{check.label}</p>
                      <p className="text-xs text-muted-foreground">{check.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {(publishIssues ?? []).length > 0 && (
              <Alert className="border-warning/40 bg-warning/10">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>Publish blockers</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                    {(publishIssues ?? []).slice(0, 6).map(issue => <li key={issue}>{issue}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="student-preview-reviewed"
                checked={studentPreviewChecked}
                onCheckedChange={checked => setStudentPreviewChecked(checked === true)}
              />
              <Label htmlFor="student-preview-reviewed" className="text-sm font-normal cursor-pointer">
                I reviewed the student preview on a learner-sized screen
              </Label>
            </div>
          </CardContent>
        </Card>
      )}

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
      {selectedVersion && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>
                Content Blocks
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  (v{selectedVersion.version_number} — {selectedVersion.title})
                </span>
              </CardTitle>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
              {canManage && !isVersionLocked && (
                <Button size="sm" onClick={openAddBlock}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Add Block
                </Button>
              )}
=======
              <div className="flex items-center gap-2">
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => setShowStudentPreview(true)} disabled={!blocks || blocks.length === 0}>
                    <Eye className="mr-2 h-3.5 w-3.5" /> Preview
                  </Button>
                )}
                {canManage && !isVersionLocked && eligibleVideoBlocks.length > 0 && (
                  <Button size="sm" variant="outline" onClick={openBulkVideoGen}>
                    <Video className="mr-2 h-3.5 w-3.5" /> Generate All Videos
                  </Button>
                )}
                {canManage && !isVersionLocked && (
                  <Button size="sm" onClick={openAddBlock}>
                    <Plus className="mr-2 h-3.5 w-3.5" /> Add Block
                  </Button>
                )}
              </div>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
            </div>
            {isVersionLocked && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                <Lock className="h-3 w-3" /> Published versions are locked; create a new version to make changes.
              </p>
            )}
          </CardHeader>
          <CardContent>
            {blocksLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}
              </div>
            ) : !blocks || blocks.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No content blocks yet.</p>
                {canManage && !isVersionLocked && (
                  <p className="text-xs text-muted-foreground/70 mt-1">Add one to start building this version.</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {blocks.map((b, idx) => (
                  <div key={b.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                        <BlockTypeBadge blockType={b.block_type} />
                        <span className="font-medium text-sm">{b.title ?? "Untitled block"}</span>
                      </div>
                      {b.block_type === "text" && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {(b.body as { content?: string } | null)?.content ?? "No content entered."}
                        </p>
                      )}
                      {b.block_type === "video" && (
                        <>
                          <p className="text-xs text-muted-foreground mt-1 truncate">{b.video_url ?? "No video URL set."}</p>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
                          {videoTranscriptContent(b) && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              Transcript: {videoTranscriptContent(b)}
                            </p>
                          )}
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
                          {(() => {
                            const job = (b.body as { heygen?: { status?: string; error?: string } } | null)?.heygen;
                            if (!job || job.status === "completed") return null;
                            if (job.status === "failed") {
                              return <p className="text-xs text-destructive mt-1">AI generation failed: {job.error ?? "unknown error"}</p>;
                            }
                            return <p className="text-xs text-muted-foreground mt-1 italic">AI avatar video generating…</p>;
                          })()}
                        </>
                      )}
                      {(b.block_type === "pdf" || b.block_type === "scorm") && (
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
                        <p className="text-xs text-muted-foreground mt-1">{b.document_id ? `Document: ${b.document_id}` : "No document attached."}</p>
                      )}
                      {b.block_type === "quiz" && (
                        <div className="mt-1">
                          <QuizBlockSummary blockId={b.id} onConfigure={() => openQuizPrompt(b)} />
                        </div>
                      )}
                    </div>
=======
                        <p className="text-xs text-muted-foreground mt-1">
                          {b.document_id ? `Document: ${documentDisplayName(courseDocumentById.get(b.document_id)) || b.document_id}` : "No document attached."}
                        </p>
                      )}
                      {b.block_type === "quiz" && (
                        <div className="mt-1">
                          <QuizBlockSummary
                            blockId={b.id}
                            onConfigure={() => openQuizPrompt(b)}
                            canManage={canManage}
                            role={user?.role}
                          />
                        </div>
                      )}
                    </div>
                    {canManage && !isVersionLocked && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          disabled={idx === 0 || reorderingBlocks}
                          onClick={() => handleMoveBlock(idx, -1)}
                          aria-label="Move block up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          disabled={idx === blocks.length - 1 || reorderingBlocks}
                          onClick={() => handleMoveBlock(idx, 1)}
                          aria-label="Move block down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
                    {canManage && !isVersionLocked && b.block_type === "video" && (
                      <>
                        {(() => {
                          const job = (b.body as { heygen?: { status?: string } } | null)?.heygen;
                          if (!job || job.status === "completed" || job.status === "failed") return null;
                          return (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground shrink-0"
                              onClick={() => handleCheckVideoStatus(b)}
                              disabled={checkingVideoStatus}
                              aria-label="Check video generation status"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          );
                        })()}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground shrink-0"
                          onClick={() => openVideoGen(b)}
                          aria-label="Generate AI avatar video"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {canManage && !isVersionLocked && (
                      <Button
                        variant="ghost"
                        size="icon"
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
                        className="h-8 w-8 text-muted-foreground shrink-0"
                        onClick={() => openRegenerateBlock(b)}
                        aria-label="Regenerate with AI"
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canManage && !isVersionLocked && (
                      <Button
                        variant="ghost"
                        size="icon"
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
                        className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => setBlockPendingDelete(b)}
                        aria-label="Delete block"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit course metadata */}
      <Dialog open={showEditCourse} onOpenChange={o => { if (!o) setShowEditCourse(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Course</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Title *</Label>
              <Input value={courseForm.title} onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={courseForm.description} onChange={e => setCourseForm(f => ({ ...f, description: e.target.value }))} />
            </div>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
            <div className="grid grid-cols-2 gap-4">
=======
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
              <div className="space-y-1">
                <Label>Category</Label>
                <Input value={courseForm.category} onChange={e => setCourseForm(f => ({ ...f, category: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={courseForm.status} onValueChange={v => setCourseForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This is the course's catalog status. It's independent of the per-version publish workflow below.
            </p>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
            <div className="space-y-1">
              <Label>Compliance Training Type</Label>
              <Select value={courseForm.trainingTypeId} onValueChange={v => setCourseForm(f => ({ ...f, trainingTypeId: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TRAINING_TYPE}>Not linked to a compliance requirement</SelectItem>
                  {(trainingTypes ?? []).map(tt => (
                    <SelectItem key={tt.id} value={tt.id}>{tt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                When a learner completes this course, it automatically records (or refreshes) their training record
                for this requirement, so their annual-hours and due-date tracking update immediately.
              </p>
            </div>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditCourse(false)}>Cancel</Button>
            <Button onClick={handleSaveCourse} disabled={savingCourse}>{savingCourse ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New version */}
      <Dialog open={showNewVersion} onOpenChange={o => { if (!o) setShowNewVersion(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Draft Version</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
              This creates version {nextVersionNumber} as a new draft. Existing published versions stay untouched and immutable.
=======
              {selectedVersion
                ? `This creates version ${nextVersionNumber} as a new draft, copying every block, quiz, question, and answer from v${selectedVersion.version_number} as a starting point. Existing published versions stay untouched and immutable.`
                : `This creates version ${nextVersionNumber} as a new, empty draft -- this course has no existing version to copy from yet.`}
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
            </p>
            <div className="space-y-1">
              <Label>Title</Label>
              <Input value={newVersionTitle} onChange={e => setNewVersionTitle(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewVersion(false)}>Cancel</Button>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
            <Button onClick={handleCreateVersion} disabled={creatingVersion}>{creatingVersion ? "Creating..." : "Create Draft"}</Button>
=======
            <Button onClick={handleCreateVersion} disabled={creatingVersion}>{creatingVersion ? (selectedVersion ? "Copying..." : "Creating...") : "Create Draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Student preview */}
      <Dialog open={showStudentPreview} onOpenChange={setShowStudentPreview}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Student Preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-normal">Course</p>
              <h2 className="text-xl font-semibold">{course.title}</h2>
              {course.description && <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{course.description}</p>}
            </div>
            {!blocks || blocks.length === 0 ? (
              <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                No content blocks to preview.
              </div>
            ) : (
              <div className="space-y-4">
                {blocks.map((block, index) => (
                  <div key={block.id} className="rounded-md border p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs text-muted-foreground">Lesson {index + 1} of {blocks.length}</p>
                        <h3 className="text-base font-semibold">{block.title ?? blockName(block)}</h3>
                      </div>
                      <BlockTypeBadge blockType={block.block_type} />
                    </div>

                    {block.block_type === "text" && (
                      <p className="text-sm leading-6 whitespace-pre-wrap">
                        {textBodyContent(block) || "No lesson text entered."}
                      </p>
                    )}

                    {block.block_type === "video" && (
                      <div className="space-y-3">
                        {block.video_url ? (
                          <div className="overflow-hidden rounded-md border bg-muted">
                            <video className="aspect-video w-full bg-black" src={block.video_url} controls />
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No video URL set.</p>
                        )}
                        {videoTranscriptContent(block) ? (
                          <div className="rounded-md bg-muted/50 p-3">
                            <p className="text-xs font-medium text-muted-foreground mb-1">Transcript</p>
                            <p className="text-sm whitespace-pre-wrap">{videoTranscriptContent(block)}</p>
                          </div>
                        ) : (
                          <p className="text-xs text-warning">Transcript or caption notes are missing.</p>
                        )}
                      </div>
                    )}

                    {(block.block_type === "pdf" || block.block_type === "scorm") && (
                      <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3">
                        <FileIcon className="h-5 w-5 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {block.document_id ? documentDisplayName(courseDocumentById.get(block.document_id)) || "Attached document" : "No document attached"}
                          </p>
                          <p className="text-xs text-muted-foreground">{block.block_type === "pdf" ? "PDF resource" : "SCORM package"}</p>
                        </div>
                      </div>
                    )}

                    {block.block_type === "quiz" && (
                      <div className="rounded-md bg-muted/50 p-3">
                        <QuizBlockSummary
                          blockId={block.id}
                          onConfigure={() => openQuizPrompt(block)}
                          canManage={false}
                          role={user?.role}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStudentPreview(false)}>Close</Button>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add block */}
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
      <Dialog open={showAddBlock} onOpenChange={o => { if (!o) setShowAddBlock(false); }}>
=======
      <Dialog open={showAddBlock} onOpenChange={o => { if (!o) handleRequestCloseAddBlock(); }}>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Content Block</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Block Type</Label>
              <Select value={blockForm.block_type} onValueChange={v => setBlockForm(f => ({ ...f, block_type: v as BlockFormState["block_type"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="scorm">SCORM</SelectItem>
                  <SelectItem value="quiz">Quiz</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Title</Label>
              <Input value={blockForm.title} onChange={e => setBlockForm(f => ({ ...f, title: e.target.value }))} placeholder="Optional block title" />
            </div>
            {blockForm.block_type === "text" && (
              <div className="space-y-1">
                <Label>Content</Label>
                <Textarea
                  value={blockForm.textContent}
                  onChange={e => setBlockForm(f => ({ ...f, textContent: e.target.value }))}
                  placeholder="Enter the text content for this block"
                  rows={6}
                />
              </div>
            )}
            {blockForm.block_type === "video" && (
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
              <div className="space-y-1">
                <Label>Video URL</Label>
                <Input value={blockForm.videoUrl} onChange={e => setBlockForm(f => ({ ...f, videoUrl: e.target.value }))} placeholder="https://..." />
                <p className="text-xs text-muted-foreground">
                  Leave blank if you plan to generate an AI avatar video after creating this block.
                </p>
              </div>
            )}
            {(blockForm.block_type === "pdf" || blockForm.block_type === "scorm") && (
              <div className="space-y-1">
                <Label>Document ID</Label>
                <Input value={blockForm.documentId} onChange={e => setBlockForm(f => ({ ...f, documentId: e.target.value }))} placeholder="Optional -- link an uploaded training document" />
=======
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Video URL</Label>
                  <Input value={blockForm.videoUrl} onChange={e => setBlockForm(f => ({ ...f, videoUrl: e.target.value }))} placeholder="https://..." />
                  <p className="text-xs text-muted-foreground">
                    Leave blank if you plan to generate an AI avatar video after creating this block.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>Transcript or Caption Notes</Label>
                  <Textarea
                    value={blockForm.videoTranscript}
                    onChange={e => setBlockForm(f => ({ ...f, videoTranscript: e.target.value }))}
                    placeholder="Paste transcript text or caption notes for learners who cannot use audio"
                    rows={4}
                  />
                </div>
              </div>
            )}
            {(blockForm.block_type === "pdf" || blockForm.block_type === "scorm") && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Document</Label>
                  <Select
                    value={blockForm.documentId || NO_DOCUMENT}
                    onValueChange={value => setBlockForm(f => ({ ...f, documentId: value === NO_DOCUMENT ? "" : value }))}
                    disabled={courseDocumentsLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={courseDocumentsLoading ? "Loading documents..." : "Select a document"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_DOCUMENT}>No document attached</SelectItem>
                      {(courseDocuments ?? []).map(document => (
                        <SelectItem key={document.id} value={document.id}>
                          {documentDisplayName(document)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={courseDocumentInputRef}
                    className="hidden"
                    type="file"
                    accept={blockForm.block_type === "pdf" ? "application/pdf,.pdf" : ".zip,application/zip,application/x-zip-compressed"}
                    onChange={handleCourseDocumentUpload}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => courseDocumentInputRef.current?.click()}
                    disabled={uploadCourseDocument.isPending || !courseDocumentUploadFacility}
                  >
                    {uploadCourseDocument.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                    Upload File
                  </Button>
                  {blockForm.documentId && (
                    <p className="text-xs text-muted-foreground truncate max-w-[18rem]">
                      {documentDisplayName(courseDocumentById.get(blockForm.documentId)) || "Selected document"}
                    </p>
                  )}
                </div>
                {!courseDocumentUploadFacility && (
                  <p className="text-xs text-muted-foreground">
                    Uploads need a facility record to own the document metadata.
                  </p>
                )}
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
              </div>
            )}
            {blockForm.block_type === "quiz" && (
              <p className="text-xs text-muted-foreground">
                After this block is created, you'll be prompted to configure the quiz itself (title, passing score, attempts).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddBlock(false)}>Cancel</Button>
            <Button onClick={handleAddBlock} disabled={creatingBlock}>{creatingBlock ? "Adding..." : "Add Block"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create quiz prompt */}
      <Dialog open={!!quizPromptBlock} onOpenChange={o => { if (!o) setQuizPromptBlock(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Configure Quiz</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Quiz Title *</Label>
              <Input value={quizForm.title} onChange={e => setQuizForm(f => ({ ...f, title: e.target.value }))} />
            </div>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
            <div className="grid grid-cols-2 gap-4">
=======
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
              <div className="space-y-1">
                <Label>Passing Score (%)</Label>
                <Input type="number" min="0" max="100" value={quizForm.passingScore} onChange={e => setQuizForm(f => ({ ...f, passingScore: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Max Attempts</Label>
                <Input type="number" min="1" value={quizForm.maxAttempts} onChange={e => setQuizForm(f => ({ ...f, maxAttempts: e.target.value }))} placeholder="Unlimited" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Questions and answers are authored separately once the quiz exists.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuizPromptBlock(null)}>Skip for now</Button>
            <Button onClick={handleCreateQuiz} disabled={creatingQuiz}>{creatingQuiz ? "Creating..." : "Create Quiz"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate AI avatar video (HeyGen) */}
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
      <Dialog open={!!videoGenBlock} onOpenChange={o => { if (!o) setVideoGenBlock(null); }}>
=======
      <Dialog open={!!videoGenBlock} onOpenChange={o => { if (!o) handleRequestCloseVideoGen(); }}>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Generate AI Avatar Video</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Generates a talking-avatar video from a script. This replaces any existing video on this block and
              typically takes a few minutes -- use the refresh action on the block to check progress.
            </p>
            <div className="space-y-1">
              <Label>Avatar *</Label>
              <Select value={videoGenForm.avatarId} onValueChange={v => setVideoGenForm(f => ({ ...f, avatarId: v }))} disabled={heygenOptionsLoading}>
                <SelectTrigger><SelectValue placeholder={heygenOptionsLoading ? "Loading avatars..." : "Select an avatar"} /></SelectTrigger>
                <SelectContent>
                  {heygenOptions?.avatars.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}{a.gender ? ` (${a.gender})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Voice *</Label>
              <Select value={videoGenForm.voiceId} onValueChange={v => setVideoGenForm(f => ({ ...f, voiceId: v }))} disabled={heygenOptionsLoading}>
                <SelectTrigger><SelectValue placeholder={heygenOptionsLoading ? "Loading voices..." : "Select a voice"} /></SelectTrigger>
                <SelectContent>
                  {heygenOptions?.voices.map(v => (
                    <SelectItem key={v.voice_id} value={v.voice_id}>{v.name}{v.language ? ` — ${v.language}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Script *</Label>
              <Textarea
                value={videoGenForm.script}
                onChange={e => setVideoGenForm(f => ({ ...f, script: e.target.value }))}
                placeholder="What should the avatar say?"
                rows={6}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVideoGenBlock(null)}>Cancel</Button>
            <Button onClick={handleGenerateVideo} disabled={generatingVideo}>{generatingVideo ? "Starting..." : "Generate Video"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======
      {/* Bulk-generate AI avatar videos for every eligible video block in this version */}
      <Dialog open={showBulkVideoGen} onOpenChange={o => { if (!o) closeBulkVideoGen(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Generate All Videos</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {!bulkGenBlockIds ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Generates an AI avatar video for every video block in this version that doesn't have one yet, using
                  one avatar and voice for all of them, and each block's AI-authored narration script.
                </p>
                <div className="space-y-1">
                  <Label>Avatar *</Label>
                  <Select value={bulkVideoForm.avatarId} onValueChange={v => setBulkVideoForm(f => ({ ...f, avatarId: v }))} disabled={bulkHeygenOptionsLoading}>
                    <SelectTrigger><SelectValue placeholder={bulkHeygenOptionsLoading ? "Loading avatars..." : "Select an avatar"} /></SelectTrigger>
                    <SelectContent>
                      {bulkHeygenOptions?.avatars.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name}{a.gender ? ` (${a.gender})` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Voice *</Label>
                  <Select value={bulkVideoForm.voiceId} onValueChange={v => setBulkVideoForm(f => ({ ...f, voiceId: v }))} disabled={bulkHeygenOptionsLoading}>
                    <SelectTrigger><SelectValue placeholder={bulkHeygenOptionsLoading ? "Loading voices..." : "Select a voice"} /></SelectTrigger>
                    <SelectContent>
                      {bulkHeygenOptions?.voices.map(v => (
                        <SelectItem key={v.voice_id} value={v.voice_id}>{v.name}{v.language ? ` — ${v.language}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  {eligibleVideoBlocksWithScript.length} block{eligibleVideoBlocksWithScript.length === 1 ? "" : "s"} will be generated.
                </p>
                {eligibleVideoBlocksMissingScript > 0 && (
                  <p className="text-xs text-muted-foreground border border-warning/40 bg-warning/10 rounded px-2 py-1.5">
                    {eligibleVideoBlocksMissingScript} block{eligibleVideoBlocksMissingScript === 1 ? "" : "s"} skipped -- no script available, add one manually first.
                  </p>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Generation runs in the background and typically takes a few minutes per video -- status below
                  updates automatically, no need to keep this dialog open.
                </p>
                {bulkGenSkippedCount > 0 && (
                  <p className="text-xs text-muted-foreground border border-warning/40 bg-warning/10 rounded px-2 py-1.5">
                    {bulkGenSkippedCount} block{bulkGenSkippedCount === 1 ? "" : "s"} skipped -- no script available, add one manually first.
                  </p>
                )}
                <div className="space-y-1.5">
                  {bulkGenBlockIds.map(blockId => {
                    const block = blocks?.find(b => b.id === blockId);
                    const status = getBulkVideoGenStatus(block, blockId);
                    const meta = BULK_STATUS_META[status];
                    return (
                      <div key={blockId} className="flex items-center justify-between gap-2 text-sm border rounded-lg px-2.5 py-1.5">
                        <span className="truncate">{block?.title ?? "Untitled block"}</span>
                        <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            {!bulkGenBlockIds ? (
              <>
                <Button variant="outline" onClick={closeBulkVideoGen}>Cancel</Button>
                <Button
                  onClick={handleGenerateAllVideos}
                  disabled={bulkGenStarting || bulkHeygenOptionsLoading || eligibleVideoBlocksWithScript.length === 0}
                >
                  {bulkGenStarting ? "Starting..." : "Generate"}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={closeBulkVideoGen}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate a block's content with AI */}
      <Dialog open={!!regenerateBlock} onOpenChange={o => { if (!o) setRegenerateBlock(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Regenerate with AI</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Claude will rewrite this block's {regenerateBlock?.block_type === "quiz" ? "entire question set" : "content"} from
              scratch based on your feedback, replacing what's there now.
            </p>
            <div className="space-y-1">
              <Label>What should change? *</Label>
              <Textarea
                value={regenerateFeedback}
                onChange={e => setRegenerateFeedback(e.target.value)}
                placeholder="e.g. &quot;make this shorter and more conversational&quot; or &quot;add more detail on fall-prevention procedures&quot;"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenerateBlock(null)}>Cancel</Button>
            <Button onClick={handleRegenerateBlock} disabled={regeneratingBlock}>{regeneratingBlock ? "Generating..." : "Generate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
      {/* Delete block confirmation */}
      <AlertDialog open={!!blockPendingDelete} onOpenChange={o => { if (!o) setBlockPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Block</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{blockPendingDelete?.title ?? "this block"}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteBlock}
              disabled={deletingBlock}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingBlock ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/CourseDetail.tsx
=======

      {/* Discard unsaved changes -- Add Block / Generate Video dialogs (see discardConfirm) */}
      <AlertDialog open={discardConfirm !== null} onOpenChange={o => { if (!o) setDiscardConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {discardConfirm === "block"
                ? "This content block hasn't been saved yet. Closing now will discard what you've entered."
                : "This video script hasn't been saved yet. Closing now will discard what you've entered."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDiscard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/CourseDetail.tsx
    </div>
  );
}
