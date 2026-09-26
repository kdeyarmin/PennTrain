import { useEffect, useMemo, useRef, useState } from "react";
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
  onCollection: (id: string) => void; onInterests: (interests: string[]) => Promise<void>; pending: boolean; error?: Error | null;
}) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const savingRef = useRef(false);
  const selectedInterests = draft ?? interests;
  // Keep the acknowledged selection until the query catches up. An older
  // background response must not flash a successfully saved checkbox off.
  useEffect(() => {
    if (!saving && draft && draft.length === interests.length && draft.every(value => interests.includes(value))) setDraft(null);
  }, [draft, interests, saving]);
  async function changeInterest(interest: string, checked: boolean) {
    if (pending || savingRef.current) return;
    const next = checked ? [...new Set([...selectedInterests, interest])] : selectedInterests.filter(value => value !== interest);
    savingRef.current = true;
    setDraft(next); setSaving(true); setSaveFailed(false);
    try { await onInterests(next); }
    catch { setDraft(draft); setSaveFailed(true); }
    finally { savingRef.current = false; setSaving(false); }
  }
  const suggested = useMemo(() => recommendedCollections(collections, selectedInterests, jobTitle), [collections, selectedInterests, jobTitle]);
  const choices = [...new Set(collections.flatMap(collection => collection.interests))].sort();
  return <div className="min-w-0 space-y-3 rounded border bg-muted/20 p-3 [overflow-wrap:anywhere]">
    <h2 className="font-semibold">Explore learning collections</h2>
    <p className="text-sm text-muted-foreground">CareMetric-selected courses for optional learning. Choosing an interest or saving a course does not create an assignment or deadline.</p>
    {error && <QueryError what="your learning interests" error={error} />}
    {!!choices.length && <fieldset aria-busy={saving}><legend className="mb-2 text-sm font-medium">Your interests</legend><div className="flex flex-wrap gap-3">{choices.map(interest => <label className="flex items-center gap-2 text-sm" key={interest}><input type="checkbox" checked={selectedInterests.includes(interest)} disabled={pending || saving} onChange={e => void changeInterest(interest, e.target.checked)} />{interest}</label>)}</div></fieldset>}
    {saving && <p role="status" className="text-sm text-muted-foreground">Saving your interests…</p>}
    {saveFailed && <p role="alert" className="text-sm text-destructive">Your interest change could not be saved. Your previous choices have been restored. Please try again.</p>}
    {!!suggested.length && <p className="text-sm">Suggested for your interests or recorded job title: {suggested.map(collection => collection.title).join(", ")}.</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant={!activeCollection ? "default" : "outline"} onClick={() => onCollection("")}>All courses</Button>{collections.map(collection => <Button size="sm" className="h-auto min-w-0 max-w-full whitespace-normal py-2 text-left" key={collection.id} variant={activeCollection === collection.id ? "default" : "outline"} onClick={() => onCollection(collection.id)}>{collection.title}{suggested.some(item => item.id === collection.id) ? " · Suggested" : ""}</Button>)}</div>
    {collections.find(collection => collection.id === activeCollection)?.description && <p className="text-sm">{collections.find(collection => collection.id === activeCollection)?.description}</p>}
    {!collections.length && <p className="text-sm text-muted-foreground">Browse the library below. Collections will appear here when published.</p>}
  </div>;
}
