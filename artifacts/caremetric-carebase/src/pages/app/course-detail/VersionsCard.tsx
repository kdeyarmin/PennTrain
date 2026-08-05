import { useState } from "react";
import { Pencil, Plus, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useUpdateCourseVersion, type Course, type CourseVersion } from "@/hooks/useCourses";
import { VersionStatusBadge } from "./components";

export function VersionsCard({
  canManage,
  onNewVersion,
  versionsLoading,
  versions,
  selectedVersionId,
  setSelectedVersionId,
  course,
  publishingVersionId,
  onPublish,
}: {
  canManage: boolean;
  onNewVersion: () => void;
  versionsLoading: boolean;
  versions: CourseVersion[] | undefined;
  selectedVersionId: string | undefined;
  setSelectedVersionId: (id: string) => void;
  course: Course;
  publishingVersionId: string | null;
  onPublish: (version: CourseVersion) => void;
}) {
  const { toast } = useToast();
  // A version could be created, cloned, published and unpublished, and its own title and
  // description could not be corrected -- so fixing a typo meant cloning the version (BACKLOG.md
  // G16.15). Drafts only: publishing is what makes a version the record of what people were taught,
  // and editing that after the fact would rewrite history rather than correct a draft.
  const updateVersion = useUpdateCourseVersion();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "" });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>Versions</CardTitle>
          {canManage && (
            <Button size="sm" onClick={onNewVersion}>
              <Plus className="mr-2 h-3.5 w-3.5" /> New Version
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {versionsLoading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
          </div>
        ) : !versions || versions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No versions yet.</p>
            {canManage && (
              <p className="text-xs text-muted-foreground/70 mt-1">Create the first draft version to start authoring this training content.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map(v => (
              <div key={v.id} className="space-y-2">
                <div
                role="button"
                tabIndex={0}
                aria-pressed={v.id === selectedVersionId}
                className={`flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${v.id === selectedVersionId ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}
                onClick={() => setSelectedVersionId(v.id)}
                onKeyDown={(e) => {
                  // Nested Publish button/tooltip trigger already stopPropagation() their own
                  // clicks; guard here so their keydown bubbling doesn't also select the row.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedVersionId(v.id);
                  }
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">v{v.version_number} — {v.title}</span>
                    <VersionStatusBadge status={v.status} />
                    {course.current_version_id === v.id && (
                      <Badge variant="outline" className="text-[10px] font-medium">Current</Badge>
                    )}
                  </div>
                  {v.published_at && (
                    <p className="text-xs text-muted-foreground mt-0.5">Published {new Date(v.published_at).toLocaleDateString()}</p>
                  )}
                </div>
                {canManage && v.status === "draft" && editingId !== v.id && (
                  <Button
                    size="sm" variant="ghost" aria-label={`Edit version ${v.version_number} details`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(v.id);
                      setForm({ title: v.title, description: v.description ?? "" });
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                {canManage && v.status === "draft" && (
                  v.ai_generated && !v.ai_reviewed_at ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* Wrapping span, not the disabled Button itself, is the trigger --
                            disabled buttons have pointer-events:none and won't fire hover. */}
                        <span onClick={(e) => e.stopPropagation()} className="inline-block">
                          <Button size="sm" variant="outline" disabled>
                            <Rocket className="mr-2 h-3.5 w-3.5" /> Publish
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        AI-generated content must be reviewed before publishing -- see the review checklist below.
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={publishingVersionId === v.id}
                      onClick={(e) => { e.stopPropagation(); onPublish(v); }}
                    >
                      <Rocket className="mr-2 h-3.5 w-3.5" />
                      {publishingVersionId === v.id ? "Publishing..." : "Publish"}
                    </Button>
                  )
                )}
                </div>
                {editingId === v.id && (
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-3" onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-1">
                      <Label htmlFor={`version-title-${v.id}`}>Title</Label>
                      <Input id={`version-title-${v.id}`} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`version-description-${v.id}`}>Description</Label>
                      <Textarea id={`version-description-${v.id}`} rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={updateVersion.isPending || !form.title.trim()}
                        onClick={() => updateVersion.mutate({
                          id: v.id,
                          title: form.title.trim(),
                          description: form.description.trim() || null,
                        }, {
                          onSuccess: () => { setEditingId(null); toast({ title: "Version updated" }); },
                          onError: (error) => toast({ title: "Could not update the version", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
                        })}
                      >
                        {updateVersion.isPending ? "Saving..." : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
