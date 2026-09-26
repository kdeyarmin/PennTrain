import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
import { recommendedCollections, type ElectiveCollection } from "@/hooks/useTrainingDiscovery";

export function SavedCoursesFilter({ savedCourseIds, availableCourseIds, selected, onChange }: {
  savedCourseIds: string[] | undefined; availableCourseIds: string[]; selected: boolean; onChange: (selected: boolean) => void;
}) {
  const available = new Set(availableCourseIds);
  const saved = new Set(savedCourseIds ?? []);
  const availableCount = [...saved].filter(id => available.has(id)).length;
  const unavailableCount = saved.size - availableCount;
  return <div className="space-y-1"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected} disabled={!savedCourseIds} onChange={e => onChange(e.target.checked)} />Saved for later ({availableCount} available)</label>
    {unavailableCount > 0 && <p className="text-xs text-muted-foreground">{unavailableCount} saved {unavailableCount === 1 ? "course is" : "courses are"} currently unavailable. Your bookmarks are kept if they become available again.</p>}
  </div>;
}

export function ElectiveDiscovery({ collections, interests, jobTitle, activeCollection, onCollection, onInterests, pending, error }: {
  collections: ElectiveCollection[]; interests: string[]; jobTitle: string | null; activeCollection: string;
  onCollection: (id: string) => void; onInterests: (interests: string[]) => void; pending: boolean; error?: Error | null;
}) {
  const suggested = useMemo(() => recommendedCollections(collections, interests, jobTitle), [collections, interests, jobTitle]);
  const choices = [...new Set(collections.flatMap(collection => collection.interests))].sort();
  return <div className="min-w-0 space-y-3 rounded border bg-muted/20 p-3 [overflow-wrap:anywhere]">
    <h2 className="font-semibold">Explore learning collections</h2>
    <p className="text-sm text-muted-foreground">CareMetric-selected courses for optional learning. Choosing an interest or saving a course does not create an assignment or deadline.</p>
    {error && <QueryError what="your learning interests" error={error} />}
    {!!choices.length && <fieldset><legend className="mb-2 text-sm font-medium">Your interests</legend><div className="flex flex-wrap gap-3">{choices.map(interest => <label className="flex items-center gap-2 text-sm" key={interest}><input type="checkbox" checked={interests.includes(interest)} disabled={pending} onChange={e => onInterests(e.target.checked ? [...interests, interest] : interests.filter(value => value !== interest))} />{interest}</label>)}</div></fieldset>}
    {!!suggested.length && <p className="text-sm">Suggested for your interests or recorded job title: {suggested.map(collection => collection.title).join(", ")}.</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant={!activeCollection ? "default" : "outline"} onClick={() => onCollection("")}>All courses</Button>{collections.map(collection => <Button size="sm" className="h-auto min-w-0 max-w-full whitespace-normal py-2 text-left" key={collection.id} variant={activeCollection === collection.id ? "default" : "outline"} onClick={() => onCollection(collection.id)}>{collection.title}{suggested.some(item => item.id === collection.id) ? " · Suggested" : ""}</Button>)}</div>
    {collections.find(collection => collection.id === activeCollection)?.description && <p className="text-sm">{collections.find(collection => collection.id === activeCollection)?.description}</p>}
    {!collections.length && <p className="text-sm text-muted-foreground">Browse the library below. Collections will appear here when published.</p>}
  </div>;
}
