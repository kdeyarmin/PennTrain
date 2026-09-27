import { useCourseMediaUrl } from "@/hooks/useCourseMedia";
import { Button } from "@/components/ui/button";
import { documentDisplayName } from "@/lib/documentDisplayName";

export function CourseMediaDocumentLink({ versionId, blockId, assetId, title }: { versionId: string; blockId: string; assetId: string; title?: string | null }) {
  const media = useCourseMediaUrl(versionId, blockId, assetId);
  return <div className="space-y-2">
    {media.isLoading && <p className="text-sm">Loading course PDF…</p>}
    {media.error && <p role="alert" className="text-sm text-destructive">{media.error}</p>}
    {media.url && <a href={media.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open {documentDisplayName({ title, fallback: "course document" })}</a>}
    <Button variant="ghost" size="sm" onClick={media.refresh} disabled={media.isLoading}>Refresh PDF link</Button>
  </div>;
}
