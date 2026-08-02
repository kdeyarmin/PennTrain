import { useEffect, useState } from "react";
import { useListHeygenOptions, useGenerateCourseVideo } from "@/hooks/useCourseVideoGeneration";
import { useToast } from "@/hooks/use-toast";
import type { CourseBlock } from "@/hooks/useCourses";

export type BulkVideoGenStatus = "queued" | "processing" | "completed" | "failed";

// --- Bulk "Generate All Videos": one avatar/voice pick, applied to every video block in
// this version that doesn't have a video yet, using each block's AI-authored body.script
// as the narration. Blocks with no script (never AI-generated/authored) are skipped rather
// than guessed at -- the admin has to add a script manually first. ---
export function useBulkVideoGeneration(blocks: CourseBlock[] | undefined) {
  const { toast } = useToast();
  const eligibleVideoBlocks = (blocks ?? []).filter(b => b.block_type === "video" && !b.video_url);
  const eligibleVideoBlocksWithScript = eligibleVideoBlocks.filter(
    b => !!(b.body as { script?: string } | null)?.script?.trim(),
  );
  const eligibleVideoBlocksMissingScript = eligibleVideoBlocks.length - eligibleVideoBlocksWithScript.length;

  const [showBulkVideoGen, setShowBulkVideoGen] = useState(false);
  const [bulkVideoForm, setBulkVideoForm] = useState({ avatarId: "", voiceId: "" });
  const { data: bulkHeygenOptions, isLoading: bulkHeygenOptionsLoading } = useListHeygenOptions(showBulkVideoGen);
  const preferredBulkHeygenAvatar = bulkHeygenOptions?.avatars.find(a => a.is_ai_twin) ?? bulkHeygenOptions?.avatars[0];
  const preferredBulkHeygenVoice = bulkHeygenOptions?.voices.find(v => /english|en[-_ ]?us|en[-_ ]?gb/i.test(`${v.language ?? ""} ${v.name ?? ""}`)) ?? bulkHeygenOptions?.voices[0];
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

  useEffect(() => {
    if (!showBulkVideoGen) return;
    setBulkVideoForm(f => ({
      avatarId: f.avatarId || preferredBulkHeygenAvatar?.id || "",
      voiceId: f.voiceId || preferredBulkHeygenVoice?.voice_id || "",
    }));
  }, [preferredBulkHeygenAvatar?.id, preferredBulkHeygenVoice?.voice_id, showBulkVideoGen]);

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

  const getBulkVideoGenStatus = (block: CourseBlock | undefined, blockId: string): BulkVideoGenStatus => {
    if (bulkGenStartFailures.has(blockId)) return "failed";
    if (!block) return "queued";
    if (block.video_url) return "completed";
    const heygenStatus = (block.body as { heygen?: { status?: string } } | null)?.heygen?.status;
    if (heygenStatus === "failed") return "failed";
    if (heygenStatus && heygenStatus !== "completed") return "processing";
    return "queued";
  };

  return {
    eligibleVideoBlocks,
    eligibleVideoBlocksWithScript,
    eligibleVideoBlocksMissingScript,
    showBulkVideoGen,
    bulkVideoForm,
    setBulkVideoForm,
    bulkHeygenOptions,
    bulkHeygenOptionsLoading,
    bulkGenBlockIds,
    bulkGenSkippedCount,
    bulkGenStartFailures,
    bulkGenStarting,
    openBulkVideoGen,
    closeBulkVideoGen,
    handleGenerateAllVideos,
    getBulkVideoGenStatus,
  };
}
