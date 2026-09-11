import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAdminLearningPackages } from '@/hooks/useLearningRuntime';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/QueryState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Dependency = { versionId: string; versionTitle: string; versionNumber: number; courseTitle: string;
  sourcePackageId: string; sourceSha256: string; standard: string; replacementPackageId: string | null; resolved: boolean };
function DependencyRow({ dependency }: { dependency: Dependency }) {
  const packages = useAdminLearningPackages(dependency.versionId);
  const client = useQueryClient();
  const { toast } = useToast();
  const [replacement, setReplacement] = useState('');
  const candidates = (packages.data ?? []).filter(pkg => pkg.course_version_id === dependency.versionId
    && pkg.validation_status === 'accepted' && pkg.standard_type === dependency.standard && pkg.id !== dependency.sourcePackageId);
  const resolve = useMutation({ mutationFn: async () => {
    const { error } = await supabase.rpc('resolve_learning_authoring_package', { p_version_id: dependency.versionId,
      p_source_package_id: dependency.sourcePackageId, p_replacement_package_id: replacement });
    if (error) throw error;
  }, onSuccess: () => {
    void client.invalidateQueries({ queryKey: ['learning_authoring_dependencies'] });
    toast({ title: 'Replacement artifact verified' });
  }, onError: (error: Error) => toast({ title: 'Replacement was not accepted', description: error.message, variant: 'destructive' }) });
  return <div className="space-y-2 rounded-lg border p-3">
    <p className="font-medium">{dependency.courseTitle} · v{dependency.versionNumber} · {dependency.versionTitle}</p>
    <p className="text-sm text-muted-foreground">{dependency.standard} · source SHA {dependency.sourceSha256.slice(0, 12)}…</p>
    {dependency.resolved ? <p className="text-sm">Separate accepted replacement verified.</p> : <>
      {packages.isError && <QueryError what="replacement packages" error={packages.error} onRetry={() => void packages.refetch()} />}
      <label className="block text-sm">Accepted replacement for this draft
        <select className="mt-1 block w-full rounded border bg-background p-2" value={replacement} onChange={event => setReplacement(event.target.value)}>
          <option value="">Choose a separately uploaded artifact</option>
          {candidates.map(pkg => <option key={pkg.id} value={pkg.id}>{pkg.entry_point ?? pkg.standard_type} · {pkg.content_sha256.slice(0, 12)}…</option>)}
        </select>
      </label>
      {candidates.length === 0 && !packages.isLoading && <p className="text-sm text-muted-foreground">Upload the replacement from this draft’s course editor and accept it above. The upload must use a new storage path.</p>}
      <Button size="sm" disabled={resolve.isPending || !candidates.some(pkg => pkg.id === replacement)} onClick={() => resolve.mutate()}>Verify replacement</Button>
    </>}
  </div>;
}
export function AuthoringPackageDependencies() {
  const dependencies = useQuery({ queryKey: ['learning_authoring_dependencies'], queryFn: async () => {
    const { data, error } = await supabase.rpc('list_learning_authoring_dependencies', {});
    if (error) throw error;
    return (data ?? []) as Dependency[];
  } });
  return <Card><CardHeader><CardTitle className="text-base">Cloned course package dependencies</CardTitle>
    <CardDescription>Cloning retains package requirements. Each replacement needs its own upload, acceptance and verification before the draft can publish.</CardDescription>
  </CardHeader><CardContent className="space-y-3">
    {dependencies.isError && <QueryError what="course package dependencies" error={dependencies.error} onRetry={() => void dependencies.refetch()} />}
    {dependencies.isLoading && <p>Loading dependencies…</p>}
    {!dependencies.isLoading && !dependencies.isError && dependencies.data?.length === 0 && <p className="text-sm text-muted-foreground">No cloned draft package dependencies.</p>}
    {dependencies.data?.map(dependency => <DependencyRow key={`${dependency.versionId}:${dependency.sourcePackageId}`} dependency={dependency} />)}
  </CardContent></Card>;
}
