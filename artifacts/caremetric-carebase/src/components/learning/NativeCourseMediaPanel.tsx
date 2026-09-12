import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCourseMediaContext, useFinishCourseMedia, callCourseMedia } from "@/hooks/useCourseMedia";
import { mediaMime, parseMediaOperation, projectMediaStage, type MediaUpload } from "../../../../../supabase/functions/_shared/courseMediaProtocol";
import { errorText } from "@/lib/errorText";

export function NativeCourseMediaPanel({ versionId, blockId, type, locked = false }: { versionId: string; blockId: string; type: "pdf" | "video"; locked?: boolean }) {
  const context = useCourseMediaContext(versionId, blockId);
  const client = useQueryClient();
  const finish = useFinishCourseMedia(); const request = useRef<MediaUpload | null>(null);
  const [file, setFile] = useState<File | null>(null); const [reason, setReason] = useState(""); const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const busy = pending || finish.isPending;
  async function stage() {
    if (busy || context.error || !file || !context.data) return;
    setPending(true); setError(null); setMessage(null);
    try {
      if (file.size < 1 || file.size > (type === "pdf" ? 26_214_400 : 104_857_600)) throw new Error("The file exceeds this media type’s size limit.");
      if (!mediaMime(file.type) || (type === "pdf") !== (file.type === "application/pdf")) throw new Error("Choose a PDF, MP4 or WebM file.");
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map(value => value.toString(16).padStart(2, "0")).join("");
      if (!request.current) request.current = parseMediaOperation({ operation: "media.upload", requestId: crypto.randomUUID(), versionId, blockId,
        sourceRevision: context.data.sourceRevision, reason: reason.trim(), fileName: file.name.normalize("NFC").trim(), mimeType: file.type, sourceSha256: sha, sourceBytes: file.size }) as MediaUpload;
      const result = projectMediaStage(await callCourseMedia(request.current, file), request.current);
      if (result.state === "committed") {
        for (const key of ["course_blocks", "courses", "governed_draft_source", "course_version_publish_issues"])
          void client.invalidateQueries({ queryKey: [key] });
        setMessage("This upload was already attached. Its saved receipt has been recovered.");
      } else setMessage("Original bytes are verified. Review the saved upload below, then attach it to this draft.");
      await context.refetch();
    } catch (cause) { setError(errorText(cause)); await context.refetch(); }
    finally { setPending(false); }
  }
  return <section className="mt-3 space-y-2 rounded border p-3" aria-label="Course media">
    <p className="text-sm font-medium">Course-owned {type === "pdf" ? "PDF" : "video"}</p>
    {context.isLoading && <p className="text-xs">Loading media…</p>}
    {context.error && <p role="alert" className="text-sm text-destructive">{errorText(context.error)}</p>}
    {context.data?.block.mediaAsset && <p className="text-xs">Attached: {context.data.block.mediaAsset.fileName} · {context.data.block.mediaAsset.byteSize.toLocaleString()} bytes</p>}
    {!locked && <>
      <Label htmlFor={`media-file-${blockId}`}>Original {type === "pdf" ? "PDF (up to 25 MiB)" : "MP4 or WebM (up to 100 MiB)"}</Label>
      <Input id={`media-file-${blockId}`} type="file" accept={type === "pdf" ? "application/pdf" : "video/mp4,video/webm"} disabled={busy}
        onChange={event => { setFile(event.target.files?.[0] ?? null); request.current = null; setMessage(null); }} />
      <Label htmlFor={`media-reason-${blockId}`}>Reason for this attachment</Label>
      <Input id={`media-reason-${blockId}`} value={reason} disabled={busy} maxLength={500} onChange={event => { setReason(event.target.value); request.current = null; }} />
      {context.data?.block.generationState === "pending" && <p className="text-xs">Reconcile the pending video generation before replacing its media.</p>}
      <Button size="sm" disabled={busy || !!context.error || !file || !context.data || reason.trim().length < 8 || context.data.block.generationState === "pending"} onClick={() => void stage()}>{pending ? "Verifying upload…" : "Upload for review"}</Button>
    </>}
    <Button variant="ghost" size="sm" disabled={busy} onClick={() => { request.current = null; void context.refetch(); }}>Refresh saved uploads</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
    {context.data?.intents.items.map(intent => <div key={intent.operationId} className="border-t pt-2 text-xs">
      <p>{intent.fileName} · {intent.byteSize.toLocaleString()} bytes · {intent.state}</p><p>{intent.reason}</p>
      {intent.state === "committed" ? <p>Saved attachment receipt retained.</p> : intent.canFinishThisSession && !locked ?
        <Button size="sm" disabled={busy || !!context.error} onClick={async () => { setError(null); try { await finish.mutateAsync(intent.operationId); setMessage("Verified media attached to this draft."); } catch (cause) { setError(errorText(cause)); } }}>Attach verified media</Button>
        : <p>This saved operation cannot be attached in the current session or draft. Refresh and upload again after reviewing the current source.</p>}
    </div>)}
    {context.data?.intents.hasMore && <p className="text-xs">Showing the 20 most recent saved uploads.</p>}
  </section>;
}
