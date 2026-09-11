import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { QueryError } from '@/components/QueryState';
import { useToast } from '@/hooks/use-toast';
import { useMarkAiGenerationReviewed } from '@/hooks/useAiCourseGeneration';
import { errorText } from '@/lib/errorText';
import { executeNativeDraft, loadGovernedDraftSource, nativeDraftIntent, type DraftPatch, type GovernedDraftSource, type NativeDraftIntent } from '@/lib/governedLearningDraft';
import { NativeGovernedStructureEditor } from './NativeGovernedStructureEditor';

export function NativeGovernedDraftEditor({ versionId, userId, onGovernedChange, onDirtyChange }: { versionId: string; userId: string; onGovernedChange: (value: boolean | null) => void; onDirtyChange: (value: boolean) => void }) {
  const sourceQuery = useQuery({ queryKey: ['governed_draft_source', versionId], queryFn: () => loadGovernedDraftSource(versionId), refetchOnWindowFocus: false });
  const [source, setSource] = useState<GovernedDraftSource | null>(null);
  const [blockId, setBlockId] = useState('');
  const [form, setForm] = useState({ title: '', content: '', transcript: '', minutes: '' });
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [structureDirty, setStructureDirty] = useState(false);
  const intent = useRef<NativeDraftIntent | null>(null);
  const client = useQueryClient(); const { toast } = useToast();
  const review = useMarkAiGenerationReviewed();
  useEffect(() => { onGovernedChange(sourceQuery.isSuccess ? !!sourceQuery.data : null); return () => onGovernedChange(null); }, [sourceQuery.data, sourceQuery.isSuccess, onGovernedChange]);
  useEffect(() => { if (!source && sourceQuery.data) setSource(sourceQuery.data); }, [source, sourceQuery.data]);
  const block = source?.document.blocks.find(row => row.id === blockId);
  const bodyEditable = !!block && (block.body === null || typeof block.body === 'object' && !Array.isArray(block.body));
  const contentEditable = bodyEditable && block?.type === 'text' && (block.body?.content == null || typeof block.body.content === 'string');
  const transcriptEditable = bodyEditable && block?.type === 'video' && (block.body?.transcript == null || typeof block.body.transcript === 'string');
  const minutesEditable = bodyEditable && !!block && ['text', 'video'].includes(block.type) && (block.body?.estimated_minutes == null || typeof block.body.estimated_minutes === 'number');
  const patch: DraftPatch = { blocks: [] };
  if (block) {
    const update: NonNullable<DraftPatch['blocks']>[number] = { blockId };
    if ((form.title.trim() || null) !== block.title) update.title = form.title.trim() || null;
    if (contentEditable && form.content !== String(block.body?.content ?? '')) update.content = form.content;
    if (transcriptEditable && form.transcript !== String(block.body?.transcript ?? '')) update.transcript = form.transcript;
    if (minutesEditable && form.minutes !== '' && Number(form.minutes) !== block.body?.estimated_minutes) update.estimatedMinutes = Number(form.minutes);
    if (Object.keys(update).length > 1) patch.blocks!.push(update);
  }
  const dirty = !!patch.blocks?.length;
  useEffect(() => { onDirtyChange(dirty || busy || structureDirty); return () => onDirtyChange(false); }, [dirty, busy, structureDirty, onDirtyChange]);
  const selectBlock = (id: string) => {
    const row = source?.document.blocks.find(item => item.id === id); setBlockId(id); setReviewed(false);
    setForm({ title: row?.title ?? '', content: typeof row?.body?.content === 'string' ? row.body.content : '',
      transcript: typeof row?.body?.transcript === 'string' ? row.body.transcript : '',
      minutes: typeof row?.body?.estimated_minutes === 'number' ? String(row.body.estimated_minutes) : '' });
  };
  const reload = async () => {
    const result = await sourceQuery.refetch(); if (result.error) throw result.error;
    setSource(result.data ?? null); setBlockId(''); setReviewed(false); intent.current = null;
  };
  const run = async (action: 'learning.patchDraft' | 'learning.reviewDraft') => {
    if (!source || structureDirty || (action === 'learning.reviewDraft' && (!reviewed || dirty))) return;
    const explanation = reason.trim();
    intent.current = nativeDraftIntent(intent.current, { versionId, sourceRevision: source.sourceRevision, action, reason: explanation, ...(action === 'learning.patchDraft' ? { patch } : {}) });
    setBusy(true);
    try {
      if (action === 'learning.patchDraft') await executeNativeDraft(source, action, intent.current.requestId, explanation, patch);
      else await review.mutateAsync({ courseVersionId: versionId, reviewedBy: userId, governedSource: source, requestId: intent.current.requestId, reason: explanation });
      await Promise.all([client.invalidateQueries({ queryKey: ['courses'] }), client.invalidateQueries({ queryKey: ['course_blocks', versionId] })]);
      await reload(); toast({ title: action === 'learning.patchDraft' ? 'Governed draft updated' : 'Exact draft review recorded' });
    } catch (error) {
      toast({ title: 'The draft action did not finish', description: errorText(error), variant: 'destructive' });
    } finally { setBusy(false); }
  };
  if (sourceQuery.isError && !source) return <QueryError what="governed draft source" error={sourceQuery.error} onRetry={() => void sourceQuery.refetch()} />;
  if (!source) return null;
  return <Card><CardHeader><CardTitle>Governed draft editing and review</CardTitle>
    <CardDescription>Edits and review apply to this exact source revision. Native media, credits and package acceptance retain their existing controls.</CardDescription>
  </CardHeader><CardContent className="space-y-4">
    {sourceQuery.isError && <QueryError what="updated draft source" error={sourceQuery.error} onRetry={() => void sourceQuery.refetch()} />}
    <p className="break-all text-xs text-muted-foreground">Source SHA-256: {source.sourceRevision}</p>
    <details><summary className="cursor-pointer font-medium">Inspect the exact course definitions and policies</summary>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded border p-3 text-xs">{JSON.stringify(JSON.parse(source.payload), null, 2)}</pre>
    </details>
    <label className="block text-sm">Existing block
      <select className="mt-1 w-full rounded border bg-background p-2" value={blockId} disabled={busy || dirty || structureDirty} onChange={e => selectBlock(e.target.value)}>
        <option value="">Choose a block to edit</option>{source.document.blocks.map(row => <option key={row.id} value={row.id}>{row.title ?? row.type} · {row.type}</option>)}
      </select>
    </label>
    {block && <fieldset disabled={structureDirty} className="space-y-3">
      <label className="block text-sm">Block title<Input value={form.title} maxLength={300} disabled={busy} onChange={e => { setReviewed(false); setForm(v => ({ ...v, title: e.target.value })); }} /></label>
      {contentEditable && <label className="block text-sm">Lesson text<Textarea value={form.content} maxLength={12000} rows={7} disabled={busy} onChange={e => { setReviewed(false); setForm(v => ({ ...v, content: e.target.value })); }} /></label>}
      {transcriptEditable && <label className="block text-sm">Transcript<Textarea value={form.transcript} maxLength={12000} rows={7} disabled={busy} onChange={e => { setReviewed(false); setForm(v => ({ ...v, transcript: e.target.value })); }} /></label>}
      {minutesEditable && <label className="block text-sm">Estimated minutes<Input type="number" min={0} max={1440} step={1} value={form.minutes} disabled={busy} onChange={e => { setReviewed(false); setForm(v => ({ ...v, minutes: e.target.value })); }} /></label>}
    </fieldset>}
    <label className="block text-sm">Reason for this action<Textarea value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
    {source.document.version.aiGenerated && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || dirty || structureDirty} onChange={e => setReviewed(e.target.checked)} />
      I reviewed the exact course material, assessment and credit policies shown above. I approve this revision for the existing native publication checks.</label>}
    {dirty && <p className="text-sm">Save or discard these edits before recording review. Saving clears previous AI approval.</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || structureDirty || !dirty || reason.trim().length < 10} onClick={() => void run('learning.patchDraft')}>Save reviewed changes</Button>
      {source.document.version.aiGenerated && <Button variant="outline" disabled={busy || dirty || structureDirty || !reviewed || reason.trim().length < 10} onClick={() => void run('learning.reviewDraft')}>Record exact draft review</Button>}
      <Button variant="ghost" disabled={busy || structureDirty} onClick={() => { void reload().catch(error => toast({ title: 'Could not reload draft', description: errorText(error), variant: 'destructive' })); }}>Discard edits and reload source</Button>
    </div>
    <NativeGovernedStructureEditor source={source} disabled={dirty || busy} onDirtyChange={setStructureDirty} onSaved={reload} />
  </CardContent></Card>;
}
