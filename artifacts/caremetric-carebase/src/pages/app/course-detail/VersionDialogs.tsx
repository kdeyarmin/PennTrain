import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { File as FileIcon } from "lucide-react";
import type { Course, CourseBlock, CourseVersion } from "@/hooks/useCourses";
import type { Role } from "@/lib/auth";
import { BlockTypeBadge, CourseVideoPreview, QuizBlockSummary } from "./components";
import { blockName, documentDisplayName, textBodyContent, videoTranscriptContent } from "./helpers";

export function NewVersionDialog({
  open,
  onClose,
  selectedVersion,
  nextVersionNumber,
  newVersionTitle,
  setNewVersionTitle,
  onCreate,
  creatingVersion,
  fieldIds,
}: {
  open: boolean;
  onClose: () => void;
  selectedVersion: CourseVersion | undefined;
  nextVersionNumber: number;
  newVersionTitle: string;
  setNewVersionTitle: (value: string) => void;
  onCreate: () => void;
  creatingVersion: boolean;
  fieldIds: string;
}) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Draft Version</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {selectedVersion
              ? `This creates version ${nextVersionNumber} as a new draft, copying every block, quiz, question, and answer from v${selectedVersion.version_number} as a starting point. Existing published versions stay untouched and immutable.`
              : `This creates version ${nextVersionNumber} as a new, empty draft -- this course has no existing version to copy from yet.`}
          </p>
          <div className="space-y-1">
            <Label htmlFor={`${fieldIds}-title-2`}>Title</Label>
            <Input id={`${fieldIds}-title-2`} value={newVersionTitle} onChange={e => setNewVersionTitle(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onCreate} disabled={creatingVersion}>{creatingVersion ? (selectedVersion ? "Copying..." : "Creating...") : "Create Draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StudentPreviewDialog({
  open,
  onOpenChange,
  course,
  blocks,
  courseDocumentById,
  userRole,
  openQuizPrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course;
  blocks: CourseBlock[] | undefined;
  courseDocumentById: Map<string, { file_name: string; storage_path: string }>;
  userRole: Role | undefined;
  openQuizPrompt: (block: CourseBlock) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Student Preview</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md border p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-normal">Training item</p>
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
                          <CourseVideoPreview src={block.video_url} />
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
                        role={userRole}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
