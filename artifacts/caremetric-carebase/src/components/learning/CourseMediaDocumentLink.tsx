import { useCourseMediaUrl } from "@/hooks/useCourseMedia";
import { Button } from "@/components/ui/button";

export function CourseMediaDocumentLink({ versionId, blockId, assetId }: { versionId: string; blockId: string; assetId: string }) {
  const media = useCourseMediaUrl(versionId, blockId, assetId);
  return <div className="space-y-2">
    {media.isLoading && <p className="text-sm">Loading course PDF…</p>}
    {media.error && <p role="alert" className="text-sm text-destructive">{media.error}</p>}
    {media.url && <a href={media.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open course PDF</a>}
    <Button variant="ghost" size="sm" onClick={media.refresh} disabled={media.isLoading}>Refresh PDF link</Button>
  </div>;
}
