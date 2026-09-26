import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
import { recommendedCollections, type ElectiveCollection } from "@/hooks/useTrainingDiscovery";

export function ElectiveDiscovery({ collections, interests, jobTitle, activeCollection, onCollection, onInterests, pending, error }: {
  collections: ElectiveCollection[]; interests: string[]; jobTitle: string | null; activeCollection: string;
  onCollection: (id: string) => void; onInterests: (interests: string[]) => void; pending: boolean; error?: Error | null;
}) {
  const suggested = useMemo(() => recommendedCollections(collections, interests, jobTitle), [collections, interests, jobTitle]);
  const choices = [...new Set(collections.flatMap(collection => collection.interests))].sort();
  return <div className="space-y-3 rounded border bg-muted/20 p-3">
    <h2 className="font-semibold">Explore learning collections</h2>
    <p className="text-sm text-muted-foreground">CareMetric-selected courses for optional learning. Choosing an interest or saving a course does not create an assignment or deadline.</p>
    {error && <QueryError what="your learning interests" error={error} />}
    {!!choices.length && <fieldset><legend className="mb-2 text-sm font-medium">Your interests</legend><div className="flex flex-wrap gap-3">{choices.map(interest => <label className="flex items-center gap-2 text-sm" key={interest}><input type="checkbox" checked={interests.includes(interest)} disabled={pending} onChange={e => onInterests(e.target.checked ? [...interests, interest] : interests.filter(value => value !== interest))} />{interest}</label>)}</div></fieldset>}
    {!!suggested.length && <p className="text-sm">Suggested for your interests or recorded job title: {suggested.map(collection => collection.title).join(", ")}.</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant={!activeCollection ? "default" : "outline"} onClick={() => onCollection("")}>All courses</Button>{collections.map(collection => <Button size="sm" key={collection.id} variant={activeCollection === collection.id ? "default" : "outline"} onClick={() => onCollection(collection.id)}>{collection.title}{suggested.some(item => item.id === collection.id) ? " · Suggested" : ""}</Button>)}</div>
    {collections.find(collection => collection.id === activeCollection)?.description && <p className="text-sm">{collections.find(collection => collection.id === activeCollection)?.description}</p>}
    {!collections.length && <p className="text-sm text-muted-foreground">Browse the library below. Collections will appear here when published.</p>}
  </div>;
}
