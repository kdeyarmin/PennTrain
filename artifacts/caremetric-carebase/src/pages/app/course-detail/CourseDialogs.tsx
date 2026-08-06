import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TrainingType } from "@/hooks/useTrainingTypes";
import { NO_TRAINING_TYPE, type CourseFormState } from "./types";

export function EditCourseDialog({
  open,
  onClose,
  courseForm,
  setCourseForm,
  trainingTypes,
  onSave,
  savingCourse,
  fieldIds,
}: {
  open: boolean;
  onClose: () => void;
  courseForm: CourseFormState;
  setCourseForm: Dispatch<SetStateAction<CourseFormState>>;
  trainingTypes: TrainingType[] | undefined;
  onSave: () => void;
  savingCourse: boolean;
  fieldIds: string;
}) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Training Content</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor={`${fieldIds}-title`}>Title *</Label>
            <Input id={`${fieldIds}-title`} value={courseForm.title} onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${fieldIds}-description`}>Description</Label>
            <Textarea id={`${fieldIds}-description`} value={courseForm.description} onChange={e => setCourseForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor={`${fieldIds}-category`}>Category</Label>
              <Input id={`${fieldIds}-category`} value={courseForm.category} onChange={e => setCourseForm(f => ({ ...f, category: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fieldIds}-status`}>Status</Label>
              <Select value={courseForm.status} onValueChange={v => setCourseForm(f => ({ ...f, status: v }))}>
                <SelectTrigger id={`${fieldIds}-status`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            This is the training item's catalog status. It's independent of the per-version publish workflow below.
          </p>
          <div className="space-y-1">
            <Label htmlFor={`${fieldIds}-training-requirement-type`}>Training Requirement Type</Label>
            <Select value={courseForm.trainingTypeId} onValueChange={v => setCourseForm(f => ({ ...f, trainingTypeId: v }))}>
              <SelectTrigger id={`${fieldIds}-training-requirement-type`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TRAINING_TYPE}>Not linked to a compliance requirement</SelectItem>
                {(trainingTypes ?? []).map(tt => (
                  <SelectItem key={tt.id} value={tt.id}>{tt.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              When an employee completes this training item, it automatically records (or refreshes) their training record
              for this requirement, so their annual-hours and due-date tracking update immediately.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={savingCourse}>{savingCourse ? "Saving..." : "Save Changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UnpublishCourseDialog({
  open,
  onOpenChange,
  onClose,
  unpublishReason,
  setUnpublishReason,
  onUnpublish,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  unpublishReason: string;
  setUnpublishReason: (value: string) => void;
  onUnpublish: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next) setUnpublishReason("");
      onOpenChange(next);
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Unpublish this course?</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            This archives the course for new enrollment. Multi-factor verification is required and the action is recorded in the audit log.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="unpublish-reason">Reason</Label>
            <Textarea
              id="unpublish-reason"
              value={unpublishReason}
              onChange={(event) => setUnpublishReason(event.target.value)}
              placeholder="Explain why this course must be removed (at least 8 characters)."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setUnpublishReason(""); onClose(); }}>Cancel</Button>
          <Button variant="destructive" onClick={onUnpublish} disabled={isPending || unpublishReason.trim().length < 8}>
            {isPending ? "Unpublishing..." : "Unpublish course"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
