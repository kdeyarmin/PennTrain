import type { Dispatch, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { HeygenAvatar, HeygenVoice } from "@/hooks/useCourseVideoGeneration";
import type { CourseBlock } from "@/hooks/useCourses";
import type { BulkVideoGenStatus } from "./useBulkVideoGeneration";

type HeygenOptions = { avatars: HeygenAvatar[]; voices: HeygenVoice[] } | undefined;
type VideoGenForm = { avatarId: string; voiceId: string; script: string };
type BulkVideoForm = { avatarId: string; voiceId: string };

export function VideoGenDialog({
  open,
  onRequestClose,
  onCancel,
  videoGenForm,
  setVideoGenForm,
  heygenOptions,
  heygenOptionsLoading,
  onGenerate,
  generatingVideo,
  fieldIds,
}: {
  open: boolean;
  onRequestClose: () => void;
  onCancel: () => void;
  videoGenForm: VideoGenForm;
  setVideoGenForm: Dispatch<SetStateAction<VideoGenForm>>;
  heygenOptions: HeygenOptions;
  heygenOptionsLoading: boolean;
  onGenerate: () => void;
  generatingVideo: boolean;
  fieldIds: string;
}) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onRequestClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Generate AI Avatar Video</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Generates a talking-avatar video from a script. If your HeyGen account has an AI Twin, it is sorted first
            and preselected so high-quality course videos can be created with one click.
          </p>
          <div className="space-y-1">
            <Label htmlFor={`${fieldIds}-avatar`}>Avatar *</Label>
            <Select value={videoGenForm.avatarId} onValueChange={v => setVideoGenForm(f => ({ ...f, avatarId: v }))} disabled={heygenOptionsLoading}>
              <SelectTrigger id={`${fieldIds}-avatar`}><SelectValue placeholder={heygenOptionsLoading ? "Loading avatars..." : "Select an avatar"} /></SelectTrigger>
              <SelectContent>
                {heygenOptions?.avatars.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.is_ai_twin ? "AI Twin · " : ""}{a.name}{a.gender ? ` (${a.gender})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${fieldIds}-voice`}>Voice *</Label>
            <Select value={videoGenForm.voiceId} onValueChange={v => setVideoGenForm(f => ({ ...f, voiceId: v }))} disabled={heygenOptionsLoading}>
              <SelectTrigger id={`${fieldIds}-voice`}><SelectValue placeholder={heygenOptionsLoading ? "Loading voices..." : "Select a voice"} /></SelectTrigger>
              <SelectContent>
                {heygenOptions?.voices.map(v => (
                  <SelectItem key={v.voice_id} value={v.voice_id}>{v.name}{v.language ? ` — ${v.language}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${fieldIds}-script`}>Script *</Label>
            <Textarea id={`${fieldIds}-script`}
              value={videoGenForm.script}
              onChange={e => setVideoGenForm(f => ({ ...f, script: e.target.value }))}
              placeholder="What should the avatar say?"
              rows={6}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onGenerate} disabled={generatingVideo}>{generatingVideo ? "Starting..." : "Generate Video"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const BULK_STATUS_META: Record<BulkVideoGenStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-secondary text-secondary-foreground" },
  processing: { label: "Processing", className: "bg-info text-info-foreground" },
  completed: { label: "Completed", className: "bg-success text-success-foreground" },
  failed: { label: "Failed", className: "bg-destructive text-destructive-foreground" },
};

export function BulkVideoGenDialog({
  open,
  onClose,
  bulkGenBlockIds,
  bulkVideoForm,
  setBulkVideoForm,
  bulkHeygenOptions,
  bulkHeygenOptionsLoading,
  eligibleVideoBlocksWithScript,
  eligibleVideoBlocksMissingScript,
  bulkGenSkippedCount,
  blocks,
  getBulkVideoGenStatus,
  onGenerate,
  bulkGenStarting,
  fieldIds,
}: {
  open: boolean;
  onClose: () => void;
  bulkGenBlockIds: string[] | null;
  bulkVideoForm: BulkVideoForm;
  setBulkVideoForm: Dispatch<SetStateAction<BulkVideoForm>>;
  bulkHeygenOptions: HeygenOptions;
  bulkHeygenOptionsLoading: boolean;
  eligibleVideoBlocksWithScript: CourseBlock[];
  eligibleVideoBlocksMissingScript: number;
  bulkGenSkippedCount: number;
  blocks: CourseBlock[] | undefined;
  getBulkVideoGenStatus: (block: CourseBlock | undefined, blockId: string) => BulkVideoGenStatus;
  onGenerate: () => void;
  bulkGenStarting: boolean;
  fieldIds: string;
}) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Generate All Videos</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {!bulkGenBlockIds ? (
            <>
              <p className="text-xs text-muted-foreground">
                Generates an AI avatar video for every video block in this version that doesn't have one yet, using
                one avatar and voice for all of them. Your HeyGen AI Twin is sorted first when available, and each block uses its AI-authored narration script.
              </p>
              <div className="space-y-1">
                <Label htmlFor={`${fieldIds}-avatar-2`}>Avatar *</Label>
                <Select value={bulkVideoForm.avatarId} onValueChange={v => setBulkVideoForm(f => ({ ...f, avatarId: v }))} disabled={bulkHeygenOptionsLoading}>
                  <SelectTrigger id={`${fieldIds}-avatar-2`}><SelectValue placeholder={bulkHeygenOptionsLoading ? "Loading avatars..." : "Select an avatar"} /></SelectTrigger>
                  <SelectContent>
                    {bulkHeygenOptions?.avatars.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.is_ai_twin ? "AI Twin · " : ""}{a.name}{a.gender ? ` (${a.gender})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${fieldIds}-voice-2`}>Voice *</Label>
                <Select value={bulkVideoForm.voiceId} onValueChange={v => setBulkVideoForm(f => ({ ...f, voiceId: v }))} disabled={bulkHeygenOptionsLoading}>
                  <SelectTrigger id={`${fieldIds}-voice-2`}><SelectValue placeholder={bulkHeygenOptionsLoading ? "Loading voices..." : "Select a voice"} /></SelectTrigger>
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
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={onGenerate}
                disabled={bulkGenStarting || bulkHeygenOptionsLoading || eligibleVideoBlocksWithScript.length === 0}
              >
                {bulkGenStarting ? "Starting..." : "Generate"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
