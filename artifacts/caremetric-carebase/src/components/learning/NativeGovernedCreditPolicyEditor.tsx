import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useLearningCreationOptions } from '@/hooks/useCourses';
import { errorText } from '@/lib/errorText';
import { executeNativeDraft, nativeDraftIntent, type GovernedDraftSource, type NativeDraftIntent, type CreditDefinition } from '@/lib/governedLearningDraft';
import { readCreditPolicySource, creditPolicyForm, creditPolicyChange, validCreditPolicyParameters, type CreditPolicyForm } from '@/lib/governedCreditPolicy';
export function NativeGovernedCreditPolicyEditor({ source, disabled, onDirtyChange, onSaved }: {
  source: GovernedDraftSource; disabled: boolean; onDirtyChange: (dirty: boolean) => void; onSaved: () => Promise<void>;
}) {
  const original = readCreditPolicySource(source);
  const [form, setForm] = useState<CreditPolicyForm | null>(null);
  const [reason, setReason] = useState(''); const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false);
  const request = useRef<NativeDraftIntent | null>(null); const { toast } = useToast();
  const options = useLearningCreationOptions(form !== null); const types = options.data?.pages.flatMap(page => page.trainingTypes) ?? [];
  const change = original && form ? creditPolicyChange(original, form) : null;
  const locked = disabled || busy;
  useEffect(() => { onDirtyChange(form !== null || busy); return () => onDirtyChange(false); }, [form, busy, onDirtyChange]);
  useEffect(() => { setForm(null); setReviewed(false); request.current = null; }, [source.sourceRevision]);
  if (!original) return <p className="text-sm">This legacy credit definition requires native reconciliation before this editor can change it.</p>;
  const update = (next: CreditPolicyForm) => { setForm(next); setReviewed(false); };
  const edit = (id: string, patch: Partial<CreditDefinition>) => { if (form) update({ ...form, credits: form.credits.map(row => row.creditId === id ? { ...row, ...patch } : row) }); };
  const save = async () => {
    if (!change || locked || !reviewed || !validCreditPolicyParameters(source, change)) return;
    const why = reason.trim(); request.current = nativeDraftIntent(request.current, { sourceRevision: source.sourceRevision, change, reason: why }); setBusy(true);
    try { await executeNativeDraft(source, 'learning.editCreditPolicy', request.current.requestId, why, change); await onSaved(); setForm(null);
      toast({ title: 'Version credit policy saved' });
    } catch (error) { toast({ title: 'Credit policy action did not finish', description: errorText(error), variant: 'destructive' }); } finally { setBusy(false); }
  };
  return <section className="space-y-4 rounded border p-4" aria-label="Governed version credit policy">
    <h3 className="font-semibold">Version credit policy</h3>
    <p className="text-sm text-muted-foreground">Credit definitions apply to this draft. Existing completion and certificate evidence stays unchanged. Saving clears prior AI approval. Catalog duration and existing duration exemptions still apply.</p>
    {!form ? <Button variant="outline" disabled={locked} onClick={() => { setForm(creditPolicyForm(original)); setReviewed(false); }}>Edit version credits and notes</Button>
      : <fieldset disabled={locked} className="space-y-4">
        <label className="block text-sm">Version label<Input maxLength={300} value={form.versionLabel} onChange={e => update({ ...form, versionLabel: e.target.value })} /></label>
        <label className="block text-sm">Credited duration rationale (at least 40 characters when supplied)<Textarea maxLength={12000} value={form.creditedDurationRationale} onChange={e => update({ ...form, creditedDurationRationale: e.target.value })} /></label>
        {options.isError && <p role="alert" className="text-sm">Training types could not load. <button type="button" onClick={() => void options.refetch()}>Retry options</button></p>}
        {options.hasNextPage && <Button variant="outline" disabled={options.isFetchingNextPage} onClick={() => void options.fetchNextPage()}>Load more training types</Button>}
        {form.credits.map(row => {
          const previous = original.credits.find(old => old.creditId === row.creditId); const available = types.some(type => type.id === row.trainingTypeId);
          return <div key={row.creditId} className="space-y-2 rounded border p-3">
            <p className="break-all text-xs">Credit {row.creditId}</p>
            {previous ? <p className="text-sm">Training: {types.find(type => type.id === row.trainingTypeId)?.label ?? row.trainingTypeId}
              {!available && ' · Retained association; load available types to check whether changes are permitted.'}</p>
              : <label className="block text-sm">Training type<select className="w-full rounded border bg-background p-2" value={row.trainingTypeId} onChange={e => edit(row.creditId, { trainingTypeId: e.target.value })}>
                <option value="">Choose an active global training type</option>{types.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select></label>}
            <fieldset disabled={!!previous && !available} className="space-y-2">
              <label className="block text-sm">Topic code<Input maxLength={128} value={row.topicCode} onChange={e => edit(row.creditId, { topicCode: e.target.value })} /></label>
              <label className="block text-sm">Credit hours (decimal, such as 1.00)<Input inputMode="decimal" value={row.creditHours} onChange={e => edit(row.creditId, { creditHours: e.target.value })} /></label>
              <label className="block text-sm">Credit mode<select className="ml-2 rounded border bg-background p-2" value={row.creditMode} onChange={e => edit(row.creditId, { creditMode: e.target.value as CreditDefinition['creditMode'] })}>
                <option value="automatic">Automatic after native completion checks</option><option value="verified_only">Separate qualified verification required</option></select></label>
              <label className="block text-sm">Citation note<Textarea maxLength={12000} value={row.citationNote} onChange={e => edit(row.creditId, { citationNote: e.target.value })} /></label>
              <label className="flex gap-2 text-sm"><input type="checkbox" checked={row.isActive} onChange={e => edit(row.creditId, { isActive: e.target.checked })} />Active definition</label>
            </fieldset>
            <Button variant="destructive" onClick={() => update({ ...form, credits: form.credits.filter(item => item.creditId !== row.creditId) })}>Remove this credit definition</Button>
          </div>;
        })}
        <Button variant="outline" disabled={form.credits.length >= 100} onClick={() => update({ ...form, credits: [...form.credits, { creditId: crypto.randomUUID(), trainingTypeId: '', topicCode: '', creditHours: '0.01', creditMode: 'automatic', citationNote: '', isActive: true }] })}>Add credit definition</Button>
        {change && <div className="space-y-2"><p className="text-sm">{change.credits.filter(row => !('preserve' in row)).length} changed or new definitions; {change.credits.filter(row => 'preserve' in row).length} retained unchanged.</p>
          {change.removedCreditIds.length > 0 && <p className="break-all text-sm">Remove these definitions: {change.removedCreditIds.join(', ')}</p>}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed the exact credit definitions, notes and listed removals.</label>
        </div>}
        <label className="block text-sm">Reason for this change<Textarea maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        {change && !validCreditPolicyParameters(source, change) && <p role="alert" className="text-sm">Review the field limits, distinct training types and decimal hours. A complete change must fit within 24 KiB.</p>}
        <div className="flex gap-2"><Button disabled={!change || !reviewed || reason.trim().length < 10 || !validCreditPolicyParameters(source, change)} onClick={() => void save()}>Save reviewed credit policy</Button>
          <Button variant="ghost" onClick={() => { setForm(null); setReviewed(false); }}>Discard credit policy edits</Button></div>
      </fieldset>}
  </section>;
}
