import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload } from "lucide-react";
import type { CourseBlock } from "@/hooks/useCourses";
import type { TrainingDocument } from "@/hooks/useDocuments";
import type { Facility } from "@/hooks/useFacilities";
import { documentDisplayName } from "./helpers";
import { NO_DOCUMENT, type BlockFormState, type QuizFormState } from "./types";

export function AddBlockDialog({
  open,
  onRequestClose,
  onCancel,
  blockForm,
  setBlockForm,
  courseDocumentsLoading,
  courseDocuments,
  courseDocumentInputRef,
  handleCourseDocumentUpload,
  uploadingDocument,
  courseDocumentUploadFacility,
  courseDocumentById,
  onAdd,
  creatingBlock,
  fieldIds,
}: {
  open: boolean;
  onRequestClose: () => void;
  onCancel: () => void;
  blockForm: BlockFormState;
  setBlockForm: Dispatch<SetStateAction<BlockFormState>>;
  courseDocumentsLoading: boolean;
  courseDocuments: TrainingDocument[] | undefined;
  courseDocumentInputRef: RefObject<HTMLInputElement | null>;
  handleCourseDocumentUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  uploadingDocument: boolean;
  courseDocumentUploadFacility: Facility | undefined;
  courseDocumentById: Map<string, TrainingDocument>;
  onAdd: () => void;
  creatingBlock: boolean;
  fieldIds: string;
}) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onRequestClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Content Block</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor={`${fieldIds}-block-type`}>Block Type</Label>
            <Select value={blockForm.block_type} onValueChange={v => setBlockForm(f => ({ ...f, block_type: v as BlockFormState["block_type"] }))}>
              <SelectTrigger id={`${fieldIds}-block-type`}><SelectValue /></SelectTrigger>
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
            <Label htmlFor={`${fieldIds}-title-3`}>Title</Label>
            <Input id={`${fieldIds}-title-3`} value={blockForm.title} onChange={e => setBlockForm(f => ({ ...f, title: e.target.value }))} placeholder="Optional block title" />
          </div>
          {blockForm.block_type === "text" && (
            <div className="space-y-1">
              <Label htmlFor={`${fieldIds}-content`}>Content</Label>
              <Textarea id={`${fieldIds}-content`}
                value={blockForm.textContent}
                onChange={e => setBlockForm(f => ({ ...f, textContent: e.target.value }))}
                placeholder="Enter the text content for this block"
                rows={6}
              />
            </div>
          )}
          {blockForm.block_type === "video" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`${fieldIds}-video-url`}>Video URL</Label>
                <Input id={`${fieldIds}-video-url`} value={blockForm.videoUrl} onChange={e => setBlockForm(f => ({ ...f, videoUrl: e.target.value }))} placeholder="https://..." />
                <p className="text-xs text-muted-foreground">
                  Leave blank if you plan to generate an AI avatar video after creating this block.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${fieldIds}-transcript-or-caption-notes`}>Transcript or Caption Notes</Label>
                <Textarea id={`${fieldIds}-transcript-or-caption-notes`}
                  value={blockForm.videoTranscript}
                  onChange={e => setBlockForm(f => ({ ...f, videoTranscript: e.target.value }))}
                  placeholder="Paste transcript text or caption notes for employees who cannot use audio"
                  rows={4}
                />
              </div>
            </div>
          )}
          {(blockForm.block_type === "pdf" || blockForm.block_type === "scorm") && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`${fieldIds}-document`}>Document</Label>
                <Select
                  value={blockForm.documentId || NO_DOCUMENT}
                  onValueChange={value => setBlockForm(f => ({ ...f, documentId: value === NO_DOCUMENT ? "" : value }))}
                  disabled={courseDocumentsLoading}
                >
                  <SelectTrigger id={`${fieldIds}-document`}>
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
                  disabled={uploadingDocument || !courseDocumentUploadFacility}
                >
                  {uploadingDocument ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
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
            </div>
          )}
          {blockForm.block_type === "quiz" && (
            <p className="text-xs text-muted-foreground">
              After this block is created, you'll be prompted to configure the quiz itself (title, passing score, attempts).
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onAdd} disabled={creatingBlock}>{creatingBlock ? "Adding..." : "Add Block"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuizPromptDialog({
  quizPromptBlock,
  onClose,
  quizForm,
  setQuizForm,
  onCreate,
  creatingQuiz,
  fieldIds,
}: {
  quizPromptBlock: CourseBlock | null;
  onClose: () => void;
  quizForm: QuizFormState;
  setQuizForm: Dispatch<SetStateAction<QuizFormState>>;
  onCreate: () => void;
  creatingQuiz: boolean;
  fieldIds: string;
}) {
  return (
    <Dialog open={!!quizPromptBlock} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Configure Quiz</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor={`${fieldIds}-quiz-title`}>Quiz Title *</Label>
            <Input id={`${fieldIds}-quiz-title`} value={quizForm.title} onChange={e => setQuizForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor={`${fieldIds}-passing-score`}>Passing Score (%)</Label>
              <Input id={`${fieldIds}-passing-score`} type="number" min="0" max="100" value={quizForm.passingScore} onChange={e => setQuizForm(f => ({ ...f, passingScore: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fieldIds}-max-attempts`}>Max Attempts</Label>
              <Input id={`${fieldIds}-max-attempts`} type="number" min="1" value={quizForm.maxAttempts} onChange={e => setQuizForm(f => ({ ...f, maxAttempts: e.target.value }))} placeholder="Unlimited" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Questions and answers are authored separately once the quiz exists.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Skip for now</Button>
          <Button onClick={onCreate} disabled={creatingQuiz}>{creatingQuiz ? "Creating..." : "Create Quiz"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RegenerateBlockDialog({
  regenerateBlock,
  onClose,
  regenerateFeedback,
  setRegenerateFeedback,
  onRegenerate,
  regeneratingBlock,
  fieldIds,
}: {
  regenerateBlock: CourseBlock | null;
  onClose: () => void;
  regenerateFeedback: string;
  setRegenerateFeedback: (value: string) => void;
  onRegenerate: () => void;
  regeneratingBlock: boolean;
  fieldIds: string;
}) {
  return (
    <Dialog open={!!regenerateBlock} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Regenerate with AI</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Claude will rewrite this block's {regenerateBlock?.block_type === "quiz" ? "entire question set" : "content"} from
            scratch based on your feedback, replacing what's there now.
          </p>
          <div className="space-y-1">
            <Label htmlFor={`${fieldIds}-what-should-change`}>What should change? *</Label>
            <Textarea id={`${fieldIds}-what-should-change`}
              value={regenerateFeedback}
              onChange={e => setRegenerateFeedback(e.target.value)}
              placeholder="e.g. &quot;make this shorter and more conversational&quot; or &quot;add more detail on fall-prevention procedures&quot;"
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onRegenerate} disabled={regeneratingBlock}>{regeneratingBlock ? "Generating..." : "Generate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteBlockAlertDialog({
  blockPendingDelete,
  onClose,
  onDelete,
  deletingBlock,
}: {
  blockPendingDelete: CourseBlock | null;
  onClose: () => void;
  onDelete: () => void;
  deletingBlock: boolean;
}) {
  return (
    <AlertDialog open={!!blockPendingDelete} onOpenChange={o => { if (!o) onClose(); }}>
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
            onClick={onDelete}
            disabled={deletingBlock}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deletingBlock ? "Removing..." : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DiscardConfirmAlertDialog({
  discardConfirm,
  onClose,
  onConfirmDiscard,
}: {
  discardConfirm: "block" | "video" | null;
  onClose: () => void;
  onConfirmDiscard: () => void;
}) {
  return (
    <AlertDialog open={discardConfirm !== null} onOpenChange={o => { if (!o) onClose(); }}>
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
            onClick={onConfirmDiscard}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
