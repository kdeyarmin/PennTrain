import { ArrowDown, ArrowUp, Eye, Lock, Plus, RefreshCw, Sparkles, Trash2, Video, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmergencyBlockCorrection } from "./EmergencyBlockCorrection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CourseBlock, CourseVersion } from "@/hooks/useCourses";
import type { TrainingDocument } from "@/hooks/useDocuments";
import type { Role } from "@/lib/auth";
import { BlockTypeBadge, QuizBlockSummary } from "./components";
import { documentDisplayName, videoTranscriptContent } from "./helpers";
import { QueryError } from "@/components/QueryState";

export function ContentBlocksCard({
  selectedVersion,
  canManage,
  onPreviewAsStudent,
  blocks,
  isVersionLocked,
  eligibleVideoBlockCount,
  onOpenBulkVideoGen,
  onAddBlock,
  blocksLoading,
  blocksError,
  onRetryBlocks,
  courseDocumentById,
  onConfigureQuiz,
  userRole,
  reorderingBlocks,
  onMoveBlock,
  checkingVideoStatus,
  onCheckVideoStatus,
  onOpenVideoGen,
  onRegenerateBlock,
  onDeleteBlock,
}: {
  selectedVersion: CourseVersion | undefined;
  canManage: boolean;
  onPreviewAsStudent: () => void;
  blocks: CourseBlock[] | undefined;
  isVersionLocked: boolean;
  eligibleVideoBlockCount: number;
  onOpenBulkVideoGen: () => void;
  onAddBlock: () => void;
  blocksLoading: boolean;
  blocksError?: boolean;
  onRetryBlocks?: () => void;
  courseDocumentById: Map<string, TrainingDocument>;
  onConfigureQuiz: (block: CourseBlock) => void;
  userRole: Role | undefined;
  reorderingBlocks: boolean;
  onMoveBlock: (index: number, direction: -1 | 1) => void;
  checkingVideoStatus: boolean;
  onCheckVideoStatus: (block: CourseBlock) => void;
  onOpenVideoGen: (block: CourseBlock) => void;
  onRegenerateBlock: (block: CourseBlock) => void;
  onDeleteBlock: (block: CourseBlock) => void;
}) {
  if (!selectedVersion) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>
            Content Blocks
            <span className="text-sm font-normal text-muted-foreground ml-2">
              (v{selectedVersion.version_number} — {selectedVersion.title})
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {canManage && (
              <Button size="sm" variant="outline" onClick={onPreviewAsStudent} disabled={!blocks || blocks.length === 0}>
                <Eye className="mr-2 h-3.5 w-3.5" /> Preview
              </Button>
            )}
            {canManage && !isVersionLocked && eligibleVideoBlockCount > 0 && (
              <Button size="sm" variant="outline" onClick={onOpenBulkVideoGen}>
                <Video className="mr-2 h-3.5 w-3.5" /> Generate All Videos
              </Button>
            )}
            {canManage && !isVersionLocked && (
              <Button size="sm" onClick={onAddBlock}>
                <Plus className="mr-2 h-3.5 w-3.5" /> Add Block
              </Button>
            )}
          </div>
        </div>
        {isVersionLocked && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
            <Lock className="h-3 w-3" /> Published versions are locked; create a new version to make changes.
            {userRole === "platform_admin" && " A platform admin can correct a single block in an emergency, below."}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {blocksLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}
          </div>
        ) : blocksError ? (
          <QueryError what="content blocks" error={undefined} onRetry={onRetryBlocks} />
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
                      {videoTranscriptContent(b) && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          Transcript: {videoTranscriptContent(b)}
                        </p>
                      )}
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
                    <p className="text-xs text-muted-foreground mt-1">
                      {b.document_id ? `Document: ${documentDisplayName(courseDocumentById.get(b.document_id)) || b.document_id}` : "No document attached."}
                    </p>
                  )}
                  {b.block_type === "quiz" && (
                    <div className="mt-1">
                      <QuizBlockSummary
                        blockId={b.id}
                        onConfigure={() => onConfigureQuiz(b)}
                        canManage={canManage}
                        role={userRole}
                      />
                    </div>
                  )}
                  {/* Only where the lock actually bites, and only for the one role the server
                      accepts. Per block, because a correction that rewrites a whole version is the
                      re-version this deliberately is not. Inside the block's own column so the
                      form gets the width to be read carefully. */}
                  {isVersionLocked && userRole === "platform_admin" && (
                    <EmergencyBlockCorrection block={b} />
                  )}
                </div>
                {canManage && !isVersionLocked && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      disabled={idx === 0 || reorderingBlocks}
                      onClick={() => onMoveBlock(idx, -1)}
                      aria-label="Move block up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      disabled={idx === blocks.length - 1 || reorderingBlocks}
                      onClick={() => onMoveBlock(idx, 1)}
                      aria-label="Move block down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
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
                          onClick={() => onCheckVideoStatus(b)}
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
                      onClick={() => onOpenVideoGen(b)}
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
                    className="h-8 w-8 text-muted-foreground shrink-0"
                    onClick={() => onRegenerateBlock(b)}
                    aria-label="Regenerate with AI"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                {canManage && !isVersionLocked && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => onDeleteBlock(b)}
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
  );
}
