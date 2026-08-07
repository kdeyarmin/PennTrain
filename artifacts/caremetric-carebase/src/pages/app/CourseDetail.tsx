import { useId, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import {
  useGetCourse, useUpdateCourse,
  useListCourseVersions, useCreateCourseVersion, useCloneCourseVersion, usePublishCourseVersion, useUnpublishCourse,
  useListCourseBlocks, useCreateCourseBlock, useUpdateCourseBlock, useDeleteCourseBlock,
  canEnrollInCourse, getCourseVersionPublishIssues, isCourseVersionLearnerReady, useCourseVersionPublishIssues,
  type CourseVersion, type CourseBlock, type CourseBlockInsert,
} from "@/hooks/useCourses";
import { useSelfEnrollCourse } from "@/hooks/useCourseAssignments";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useCreateQuiz } from "@/hooks/useQuizzes";
import { useListCourseFeedback, summarizeCourseFeedback } from "@/hooks/useCourseFeedback";
import {
  useListHeygenOptions, useGenerateCourseVideo, useCheckCourseVideoStatus, useAutoCheckVideoStatuses,
} from "@/hooks/useCourseVideoGeneration";
import { useRegenerateCourseBlock, useListCourseAiGenerations, useMarkAiGenerationReviewed } from "@/hooks/useAiCourseGeneration";
import { useListDocuments, useUploadDocument } from "@/hooks/useDocuments";
import { useRegisterLearningPackage } from "@/hooks/useLearningRuntime";
import { useListFacilities } from "@/hooks/useFacilities";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { coursesListPath } from "@/lib/courseRoutes";
import { textBodyContent, videoTranscriptContent } from "./course-detail/helpers";
import { EMPTY_BLOCK_FORM, NO_TRAINING_TYPE, type BlockFormState, type CourseFormState, type QuizFormState } from "./course-detail/types";
import { useBulkVideoGeneration } from "./course-detail/useBulkVideoGeneration";
import { CourseOverviewSection } from "./course-detail/CourseOverviewSection";
import { VersionsCard } from "./course-detail/VersionsCard";
import { PrePublishSection } from "./course-detail/PrePublishSection";
import { ContentBlocksCard } from "./course-detail/ContentBlocksCard";
import { EditCourseDialog, UnpublishCourseDialog } from "./course-detail/CourseDialogs";
import { NewVersionDialog, StudentPreviewDialog } from "./course-detail/VersionDialogs";
import {
  AddBlockDialog, QuizPromptDialog, RegenerateBlockDialog, DeleteBlockAlertDialog, DiscardConfirmAlertDialog,
} from "./course-detail/BlockDialogs";
import { VideoGenDialog, BulkVideoGenDialog } from "./course-detail/VideoGenDialogs";

export default function CourseDetail() {
  const __fieldIds = useId();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const canManage = user?.role === "platform_admin";

  const { data: course, isLoading: courseLoading, isError: courseError, error: courseErr, refetch: refetchCourse } = useGetCourse(id);
  const [showUnpublishCourse, setShowUnpublishCourse] = useState(false);
  const [unpublishReason, setUnpublishReason] = useState("");
  const unpublishCourse = useUnpublishCourse();
  // Only actually matters for platform_admin: courses_select RLS lets that role open any
  // organization's course (see canEnrollInCourse's own comment), but self_enroll_course rejects
  // enrolling in one that isn't system-catalog or the caller's own org -- every other role can
  // only ever reach a course RLS already scoped to their own org/system-catalog, so this is a
  // no-op for them.
  const { data: employee } = useGetEmployeeByProfileId(user?.id);
  // Prefer the employees row org when it exists; fall back to the profile org so that
  // org_admin/auditor who haven't self-enrolled yet (no employees row) still see the
  // "Start Training" button for their org's published training content.
  const effectiveOrgId = employee?.organization_id ?? user?.organizationId ?? undefined;
  const canUnpublishCourse = course?.status === "published" && (
    user?.role === "platform_admin"
    || (user?.role === "org_admin" && course.organization_id === user.organizationId)
  );

  const handleUnpublishCourse = () => {
    if (!course || unpublishReason.trim().length < 8) return;
    unpublishCourse.mutate({ courseId: course.id, reason: unpublishReason.trim() }, {
      onSuccess: () => {
        toast({ title: "Course unpublished", description: "The course is archived and no longer available for new enrollment." });
        setShowUnpublishCourse(false);
        setUnpublishReason("");
      },
      onError: (error: Error) => toast({ title: "Unable to unpublish course", description: error.message, variant: "destructive" }),
    });
  };

  const { mutate: selfEnroll, isPending: enrolling } = useSelfEnrollCourse();
  const handleTakeCourse = () => {
    if (!course) return;
    if (!canTakeCourse) {
      toast({
        title: "Training is not ready yet",
        description: "A published, reviewed training version is required before employees can start.",
        variant: "destructive",
      });
      return;
    }
    selfEnroll(course.id, {
      onSuccess: assignmentId => navigate(`/me/courses/${assignmentId}`),
      onError: (e: Error) => toast({ title: "Couldn't start training", description: e.message, variant: "destructive" }),
    });
  };

  const { data: courseFeedback, isLoading: feedbackLoading } = useListCourseFeedback({ courseId: id });
  const feedbackSummary = summarizeCourseFeedback(courseFeedback);
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
  const registerLearningPackage = useRegisterLearningPackage();
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
        label: "Training content is present",
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
        detail: "Open the student preview and confirm the content is easy to take on an employee-sized screen.",
      },
    ];
  }, [blocks, publishIssues, publishIssuesLoading, studentPreviewChecked]);

  // --- Course metadata edit ---
  const [showEditCourse, setShowEditCourse] = useState(false);
  const [courseForm, setCourseForm] = useState<CourseFormState>({ title: "", description: "", category: "", status: "draft", trainingTypeId: NO_TRAINING_TYPE });
  const { mutate: updateCourse, isPending: savingCourse } = useUpdateCourse();
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });

  const openEditCourse = () => {
    if (!course) return;
    setCourseForm({
      title: course.title,
      description: course.description ?? "",
      category: course.category ?? "",
      status: course.status,
      trainingTypeId: course.training_type_id ?? NO_TRAINING_TYPE,
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
        training_type_id: courseForm.trainingTypeId === NO_TRAINING_TYPE ? null : courseForm.trainingTypeId,
      },
      {
        onSuccess: () => { toast({ title: "Training content updated" }); setShowEditCourse(false); },
        onError: (e: Error) => toast({ title: "Failed to update training content", description: e.message, variant: "destructive" }),
      },
    );
  };

  // --- New version ---
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [newVersionTitle, setNewVersionTitle] = useState("");
  const { mutate: cloneVersion, isPending: cloningVersion } = useCloneCourseVersion();
  const { mutate: createBlankVersion, isPending: creatingBlankVersion } = useCreateCourseVersion();
  const creatingVersion = cloningVersion || creatingBlankVersion;

  const nextVersionNumber = (versions?.reduce((max, v) => Math.max(max, v.version_number), 0) ?? 0) + 1;

  const openNewVersion = () => {
    if (!course) return;
    setNewVersionTitle(`${course.title} — v${nextVersionNumber}`);
    setShowNewVersion(true);
  };

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
          setShowNewVersion(false);
          setSelectedVersionId(data.id);
        },
        onError: (e: Error) => toast({ title: "Failed to create version", description: e.message, variant: "destructive" }),
      },
    );
  };

  // --- Publish a version (database RPC validates readiness and sets course.current_version_id) ---
  const { mutateAsync: publishVersionAsync } = usePublishCourseVersion();
  const [publishingVersionId, setPublishingVersionId] = useState<string | null>(null);

  const handlePublish = async (version: CourseVersion) => {
    if (!course) return;
    if (version.id !== selectedVersionId || !studentPreviewChecked) {
      setSelectedVersionId(version.id);
      toast({
        title: "Review the student preview first",
        description: "Open the preview, check the employee training experience, then mark the checklist item before publishing.",
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
    }
  };

  // --- Blocks ---
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [blockForm, setBlockForm] = useState<BlockFormState>(EMPTY_BLOCK_FORM);
  const { mutate: createBlock, isPending: creatingBlock } = useCreateCourseBlock();
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

  const openAddBlock = () => {
    setBlockForm(EMPTY_BLOCK_FORM);
    setShowAddBlock(true);
  };

  const handleCourseDocumentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !course || !courseDocumentPrefix) return;

    if (!courseDocumentUploadFacility) {
      toast({
        title: "No facility available for document ownership",
        description: "Create or select a facility before uploading a training document.",
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

      // SCORM/xAPI zips also register into the governed learning package control plane so
      // Accept/Quarantine on Governed Learning can make them launchable.
      if (blockForm.block_type === "scorm" && selectedVersion && file.name.toLowerCase().endsWith(".zip")) {
        let packagePath: string | null = null;
        let uploadedNewObject = false;
        try {
          const buf = await file.arrayBuffer();
          const digest = await crypto.subtle.digest("SHA-256", buf);
          const sha = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
          const orgId = course.organization_id ?? courseDocumentUploadFacility.organization_id;
          packagePath = `${orgId}/${selectedVersion.id}/${sha}.zip`;
          const { error: pkgUploadError } = await supabase.storage
            .from("learning-packages")
            .upload(packagePath, file, { contentType: "application/zip", upsert: false });
          if (pkgUploadError && !String(pkgUploadError.message).toLowerCase().includes("already exists")) {
            throw pkgUploadError;
          }
          uploadedNewObject = !pkgUploadError;
          await registerLearningPackage.mutateAsync({
            courseVersionId: selectedVersion.id,
            standardType: "scorm_1_2",
            storagePath: packagePath,
            contentSha256: sha,
            compressedBytes: file.size,
            entryPoint: "index.html",
          });
          toast({
            title: "SCORM package registered",
            description: `${file.name} is pending accept on Governed Learning → Standards.`,
          });
        } catch (regErr) {
          if (uploadedNewObject && packagePath) {
            const { error: cleanupError } = await supabase.storage.from("learning-packages").remove([packagePath]);
            if (cleanupError) {
              toast({
                title: "Document attached; package register incomplete",
                description: `${(regErr as Error).message} (also failed to remove uploaded package: ${cleanupError.message})`,
                variant: "destructive",
              });
              return;
            }
          }
          toast({
            title: "Document attached; package register incomplete",
            description: (regErr as Error).message,
            variant: "destructive",
          });
          return;
        }
      } else {
        toast({ title: "Document uploaded", description: `${document.file_name} is attached to this block.` });
      }
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

  const handleAddBlock = () => {
    if (!course || !selectedVersion) return;
    const nextSort = (blocks?.reduce((max, b) => Math.max(max, b.sort_order), -1) ?? -1) + 1;
    const payload: CourseBlockInsert = {
      course_version_id: selectedVersion.id,
      organization_id: course.organization_id,
      block_type: blockForm.block_type,
      sort_order: nextSort,
      title: blockForm.title || null,
      body: blockForm.block_type === "text"
        ? { content: blockForm.textContent }
        : blockForm.block_type === "video" && blockForm.videoTranscript.trim()
          ? { transcript: blockForm.videoTranscript.trim() }
          : null,
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
  const preferredHeygenAvatar = heygenOptions?.avatars.find(a => a.is_ai_twin) ?? heygenOptions?.avatars[0];
  const preferredHeygenVoice = heygenOptions?.voices.find(v => /english|en[-_ ]?us|en[-_ ]?gb/i.test(`${v.language ?? ""} ${v.name ?? ""}`)) ?? heygenOptions?.voices[0];
  const { mutate: generateVideo, isPending: generatingVideo } = useGenerateCourseVideo();
  const { mutate: checkVideoStatus, isPending: checkingVideoStatus } = useCheckCourseVideoStatus();

  const openVideoGen = (block: CourseBlock) => {
    setVideoGenBlock(block);
    setVideoGenForm({ avatarId: "", voiceId: "", script: (block.body as { script?: string } | null)?.script ?? "" });
  };

  useEffect(() => {
    if (!videoGenBlock) return;
    setVideoGenForm(f => ({
      ...f,
      avatarId: f.avatarId || preferredHeygenAvatar?.id || "",
      voiceId: f.voiceId || preferredHeygenVoice?.voice_id || "",
    }));
  }, [preferredHeygenAvatar?.id, preferredHeygenVoice?.voice_id, videoGenBlock]);

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

  // --- Bulk "Generate All Videos" (avatar/voice picker + per-block progress) lives in
  // useBulkVideoGeneration -- it's self-contained aside from `blocks`. ---
  const bulkVideoGen = useBulkVideoGeneration(blocks);

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

  if (courseLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (courseError) {
    return <QueryError what="this training content" error={courseErr} onRetry={() => void refetchCourse()} />;
  }

  if (!course) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Training content not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={coursesListPath(user?.role)}>Back to Training Content</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CourseOverviewSection
        course={course}
        userRole={user?.role}
        selectedVersion={selectedVersion}
        effectiveOrgId={effectiveOrgId}
        canTakeCourse={canTakeCourse}
        enrolling={enrolling}
        onTakeCourse={handleTakeCourse}
        canManage={canManage}
        onEditCourse={openEditCourse}
        canUnpublishCourse={canUnpublishCourse}
        onUnpublishClick={() => setShowUnpublishCourse(true)}
        feedbackSummary={feedbackSummary}
        feedbackLoading={feedbackLoading}
      />

      <VersionsCard
        canManage={canManage}
        onNewVersion={openNewVersion}
        versionsLoading={versionsLoading}
        versions={versions}
        selectedVersionId={selectedVersionId}
        setSelectedVersionId={setSelectedVersionId}
        course={course}
        publishingVersionId={publishingVersionId}
        onPublish={handlePublish}
      />

      <PrePublishSection
        canManage={canManage}
        needsAiReview={needsAiReview}
        reviewChecked={reviewChecked}
        setReviewChecked={setReviewChecked}
        markingReviewed={markingReviewed}
        onMarkReviewed={handleMarkReviewed}
        selectedVersion={selectedVersion}
        onPreviewAsStudent={() => setShowStudentPreview(true)}
        blocks={blocks}
        prePublishChecks={prePublishChecks}
        publishIssues={publishIssues}
        studentPreviewChecked={studentPreviewChecked}
        setStudentPreviewChecked={setStudentPreviewChecked}
      />

      <ContentBlocksCard
        selectedVersion={selectedVersion}
        canManage={canManage}
        onPreviewAsStudent={() => setShowStudentPreview(true)}
        blocks={blocks}
        isVersionLocked={isVersionLocked}
        eligibleVideoBlockCount={bulkVideoGen.eligibleVideoBlocks.length}
        onOpenBulkVideoGen={bulkVideoGen.openBulkVideoGen}
        onAddBlock={openAddBlock}
        blocksLoading={blocksLoading}
        courseDocumentById={courseDocumentById}
        onConfigureQuiz={openQuizPrompt}
        userRole={user?.role}
        reorderingBlocks={reorderingBlocks}
        onMoveBlock={handleMoveBlock}
        checkingVideoStatus={checkingVideoStatus}
        onCheckVideoStatus={handleCheckVideoStatus}
        onOpenVideoGen={openVideoGen}
        onRegenerateBlock={openRegenerateBlock}
        onDeleteBlock={setBlockPendingDelete}
      />

      <EditCourseDialog
        open={showEditCourse}
        onClose={() => setShowEditCourse(false)}
        courseForm={courseForm}
        setCourseForm={setCourseForm}
        trainingTypes={trainingTypes}
        onSave={handleSaveCourse}
        savingCourse={savingCourse}
        fieldIds={__fieldIds}
      />

      <NewVersionDialog
        open={showNewVersion}
        onClose={() => setShowNewVersion(false)}
        selectedVersion={selectedVersion}
        nextVersionNumber={nextVersionNumber}
        newVersionTitle={newVersionTitle}
        setNewVersionTitle={setNewVersionTitle}
        onCreate={handleCreateVersion}
        creatingVersion={creatingVersion}
        fieldIds={__fieldIds}
      />

      <StudentPreviewDialog
        open={showStudentPreview}
        onOpenChange={setShowStudentPreview}
        course={course}
        blocks={blocks}
        courseDocumentById={courseDocumentById}
        userRole={user?.role}
        openQuizPrompt={openQuizPrompt}
      />

      <AddBlockDialog
        open={showAddBlock}
        onRequestClose={handleRequestCloseAddBlock}
        onCancel={() => setShowAddBlock(false)}
        blockForm={blockForm}
        setBlockForm={setBlockForm}
        courseDocumentsLoading={courseDocumentsLoading}
        courseDocuments={courseDocuments}
        courseDocumentInputRef={courseDocumentInputRef}
        handleCourseDocumentUpload={handleCourseDocumentUpload}
        uploadingDocument={uploadCourseDocument.isPending}
        courseDocumentUploadFacility={courseDocumentUploadFacility}
        courseDocumentById={courseDocumentById}
        onAdd={handleAddBlock}
        creatingBlock={creatingBlock}
        fieldIds={__fieldIds}
      />

      <QuizPromptDialog
        quizPromptBlock={quizPromptBlock}
        onClose={() => setQuizPromptBlock(null)}
        quizForm={quizForm}
        setQuizForm={setQuizForm}
        onCreate={handleCreateQuiz}
        creatingQuiz={creatingQuiz}
        fieldIds={__fieldIds}
      />

      <VideoGenDialog
        open={!!videoGenBlock}
        onRequestClose={handleRequestCloseVideoGen}
        onCancel={() => setVideoGenBlock(null)}
        videoGenForm={videoGenForm}
        setVideoGenForm={setVideoGenForm}
        heygenOptions={heygenOptions}
        heygenOptionsLoading={heygenOptionsLoading}
        onGenerate={handleGenerateVideo}
        generatingVideo={generatingVideo}
        fieldIds={__fieldIds}
      />

      <BulkVideoGenDialog
        open={bulkVideoGen.showBulkVideoGen}
        onClose={bulkVideoGen.closeBulkVideoGen}
        bulkGenBlockIds={bulkVideoGen.bulkGenBlockIds}
        bulkVideoForm={bulkVideoGen.bulkVideoForm}
        setBulkVideoForm={bulkVideoGen.setBulkVideoForm}
        bulkHeygenOptions={bulkVideoGen.bulkHeygenOptions}
        bulkHeygenOptionsLoading={bulkVideoGen.bulkHeygenOptionsLoading}
        eligibleVideoBlocksWithScript={bulkVideoGen.eligibleVideoBlocksWithScript}
        eligibleVideoBlocksMissingScript={bulkVideoGen.eligibleVideoBlocksMissingScript}
        bulkGenSkippedCount={bulkVideoGen.bulkGenSkippedCount}
        blocks={blocks}
        getBulkVideoGenStatus={bulkVideoGen.getBulkVideoGenStatus}
        onGenerate={bulkVideoGen.handleGenerateAllVideos}
        bulkGenStarting={bulkVideoGen.bulkGenStarting}
        fieldIds={__fieldIds}
      />

      <RegenerateBlockDialog
        regenerateBlock={regenerateBlock}
        onClose={() => setRegenerateBlock(null)}
        regenerateFeedback={regenerateFeedback}
        setRegenerateFeedback={setRegenerateFeedback}
        onRegenerate={handleRegenerateBlock}
        regeneratingBlock={regeneratingBlock}
        fieldIds={__fieldIds}
      />

      <UnpublishCourseDialog
        open={showUnpublishCourse}
        onOpenChange={setShowUnpublishCourse}
        onClose={() => setShowUnpublishCourse(false)}
        unpublishReason={unpublishReason}
        setUnpublishReason={setUnpublishReason}
        onUnpublish={handleUnpublishCourse}
        isPending={unpublishCourse.isPending}
      />

      <DeleteBlockAlertDialog
        blockPendingDelete={blockPendingDelete}
        onClose={() => setBlockPendingDelete(null)}
        onDelete={handleDeleteBlock}
        deletingBlock={deletingBlock}
      />

      <DiscardConfirmAlertDialog
        discardConfirm={discardConfirm}
        onClose={() => setDiscardConfirm(null)}
        onConfirmDiscard={handleConfirmDiscard}
      />
    </div>
  );
}
