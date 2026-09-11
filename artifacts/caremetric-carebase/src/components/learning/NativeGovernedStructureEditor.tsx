import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useEditGovernedLearningStructure } from '@/hooks/useQuizzes';
import { errorText } from '@/lib/errorText';
import { nativeDraftIntent, type GovernedDraftSource, type NativeDraftIntent, type StructureChange, type LessonFields, type LessonType } from '@/lib/governedLearningDraft';
import { ACTIVITY_TYPES, LESSON_TYPES, validStructureChanges } from '../../../../../supabase/functions/_shared/learningStructure';

type Block = GovernedDraftSource['document']['blocks'][number];
type Question = NonNullable<Block['quiz']>['questions'][number];
const id = () => crypto.randomUUID();
export function questionChange(block: Block, question?: Question): Extract<StructureChange, { operation: 'saveQuestion' }> {
  if (!block.quiz) throw new Error('Configure this quiz first.');
  return { operation: 'saveQuestion', quizId: block.quiz.id, questionId: question?.id ?? id(), prompt: question?.prompt ?? '', type: question?.type ?? 'single_choice',
    points: question?.points ?? 1, topicCode: question?.topicCode ?? null, topicLabel: question?.topicLabel ?? null, explanation: question?.explanation ?? null,
    answers: question?.options.map(answer => ({ answerId: answer.id, text: answer.text, correct: answer.correct }))
      ?? [{ answerId: id(), text: '', correct: false }, { answerId: id(), text: '', correct: false }], removedAnswerIds: [] };
}
export function removeAnswer(change: Extract<StructureChange, { operation: 'saveQuestion' }>, answerId: string, original: Question | undefined) {
  const answers = change.answers.filter(answer => answer.answerId !== answerId);
  return { ...change, answers, removedAnswerIds: (original?.options ?? []).filter(answer => !answers.some(next => next.answerId === answer.id)).map(answer => answer.id) };
}
export function NativeGovernedStructureEditor({ source, disabled, onDirtyChange, onSaved }: {
  source: GovernedDraftSource; disabled: boolean; onDirtyChange: (dirty: boolean) => void; onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [change, setChange] = useState<StructureChange | null>(null);
  const [reason, setReason] = useState(''); const [removalReviewed, setRemovalReviewed] = useState(false);
  const request = useRef<NativeDraftIntent | null>(null);
  const mutation = useEditGovernedLearningStructure(); const { toast } = useToast();
  const blocks = source.document.blocks; const block = blocks.find(row => row.id === selected);
  const busy = mutation.isPending; const locked = disabled || busy;
  useEffect(() => { onDirtyChange(!!change || busy); return () => onDirtyChange(false); }, [change, busy, onDirtyChange]);
  useEffect(() => { setSelected(''); setChange(null); setRemovalReviewed(false); request.current = null; }, [source.sourceRevision]);
  const begin = (value: StructureChange) => { setChange(value); setRemovalReviewed(false); request.current = null; };
  const configure = (row: Block) => begin({ operation: 'configureQuiz', blockId: row.id, quizId: row.quiz?.id ?? id(), title: row.quiz?.title ?? row.title ?? 'Quiz',
    kind: row.quiz?.kind ?? 'assessment', passingScore: row.quiz?.passingScore ?? 80, maxAttempts: row.quiz?.maxAttempts ?? null,
    shuffleQuestions: row.quiz?.shuffleQuestions ?? false, shuffleAnswers: row.quiz?.shuffleAnswers ?? false, revealsAnswersAfterAttempt: row.quiz?.revealsAnswersAfterAttempt ?? false });
  const moveLesson = (direction: -1 | 1) => {
    const ids = blocks.map(row => row.id); const from = ids.indexOf(selected); const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]]; begin({ operation: 'reorderLessons', blockIds: ids });
  };
  const question = change?.operation === 'saveQuestion' ? blocks.flatMap(row => row.quiz?.questions ?? []).find(row => row.id === change.questionId) : undefined;
  const removed = change?.operation === 'removeLesson' ? [change.blockId, ...change.removedQuestionIds]
    : change?.operation === 'removeQuestion' ? [change.questionId] : change?.operation === 'saveQuestion' ? change.removedAnswerIds : [];
  const changes = change ? [change] : [];
  const valid = validStructureChanges(changes);
  const save = async () => {
    if (!valid || locked || removed.length && !removalReviewed) return;
    const why = reason.trim(); request.current = nativeDraftIntent(request.current, { sourceRevision: source.sourceRevision, changes, reason: why });
    try {
      await mutation.mutateAsync({ source, requestId: request.current.requestId, reason: why, changes });
      await onSaved(); setChange(null); request.current = null;
      toast({ title: 'Structure changes saved' });
    } catch (error) { toast({ title: 'Structure changes did not finish', description: errorText(error), variant: 'destructive' }); }
  };
  const lessonType = change?.operation === 'addLesson' ? change.blockType : block?.type;
  const fields: LessonFields | null = change?.operation === 'addLesson' ? { ...change.body, title: change.title } : change?.operation === 'editLesson' ? change.patch : null;
  const setField = (key: keyof LessonFields, value: unknown) => {
    setChange(previous => {
      if (previous?.operation === 'addLesson') return key === 'title' ? { ...previous, title: value as string | null } : { ...previous, body: { ...previous.body, [key]: value } };
      if (previous?.operation === 'editLesson') {
        const native = key === 'estimatedMinutes' ? 'estimated_minutes' : key === 'activityType' ? 'activity_type' : key === 'attestationText' ? 'attestation_text' : key === 'attestationVersion' ? 'attestation_version' : key;
        const original = key === 'title' ? block?.title : block?.body?.[native];
        const patch = { ...previous.patch, [key]: value };
        if (value === original) delete patch[key];
        return { ...previous, patch };
      }
      return previous;
    });
  };
  const fieldValue = (key: keyof LessonFields, native: string) => change?.operation === 'addLesson' || fields && Object.hasOwn(fields, key) ? fields?.[key]
    : key === 'title' ? block?.title : block?.body && typeof block.body === 'object' ? block.body[native] : undefined;
  const fieldEditable = (native: string, kind: string) => change?.operation === 'addLesson' || block?.body == null
    || typeof block.body === 'object' && !Array.isArray(block.body) && (block.body[native] == null || typeof block.body[native] === kind);
  return <section className="space-y-4 rounded border p-4" aria-label="Governed lesson and quiz structure">
    <h3 className="font-semibold">Lessons and quizzes</h3>
    <p className="text-sm text-muted-foreground">Review one complete change before saving. Answer choices and their key save together. New media lessons remain incomplete until native asset checks pass.</p>
    {!change && <div className="space-y-3">
      <label className="block text-sm">Lesson<select className="mt-1 w-full rounded border bg-background p-2" disabled={locked} value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">Choose a lesson</option>{blocks.map((row, index) => <option key={row.id} value={row.id}>{index + 1}. {row.title || row.type}</option>)}
      </select></label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={locked} onClick={() => begin({ operation: 'addLesson', blockId: id(), blockType: 'text', title: null, body: {} })}>Add lesson</Button>
        {block && <>
          <Button variant="outline" disabled={locked} onClick={() => begin({ operation: 'editLesson', blockId: block.id, patch: {} })}>Edit lesson details</Button>
          <Button variant="outline" disabled={locked || blocks[0]?.id === selected} onClick={() => moveLesson(-1)}>Move up</Button>
          <Button variant="outline" disabled={locked || blocks.at(-1)?.id === selected} onClick={() => moveLesson(1)}>Move down</Button>
          <Button variant="destructive" disabled={locked} onClick={() => begin({ operation: 'removeLesson', blockId: block.id, removedQuestionIds: block.quiz?.questions.map(row => row.id) ?? [] })}>Remove lesson</Button>
          {block.type === 'quiz' && <Button variant="outline" disabled={locked} onClick={() => configure(block)}>Quiz settings</Button>}
        </>}
      </div>
      {block?.quiz && <div className="space-y-2">
        <Button variant="outline" disabled={locked} onClick={() => begin(questionChange(block))}>Add question</Button>
        {block.quiz.questions.map((row, index) => <div key={row.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
          <span className="min-w-0 flex-1 text-sm">{index + 1}. {row.prompt}</span>
          <Button size="sm" variant="outline" disabled={locked} onClick={() => begin(questionChange(block, row))}>Edit question and answers</Button>
          <Button size="sm" variant="destructive" disabled={locked} onClick={() => begin({ operation: 'removeQuestion', quizId: block.quiz!.id, questionId: row.id })}>Remove</Button>
          {([-1, 1] as const).map(direction => <Button key={direction} size="sm" variant="ghost" disabled={locked || index + direction < 0 || index + direction >= block.quiz!.questions.length}
            onClick={() => { const ids = block.quiz!.questions.map(q => q.id); [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
              begin({ operation: 'reorderQuestions', quizId: block.quiz!.id, questionIds: ids }); }}>{direction < 0 ? 'Up' : 'Down'}</Button>)}
        </div>)}
      </div>}
    </div>}
    {change && <fieldset disabled={locked} className="space-y-3">
      {change.operation === 'addLesson' && <label className="block text-sm">Lesson type<select className="ml-2 rounded border bg-background p-2" value={change.blockType}
        onChange={event => setChange({ ...change, blockType: event.target.value as LessonType, body: {} })}>{LESSON_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>}
      {fields && <>
        <label className="block text-sm">Lesson title<Input maxLength={300} value={String(fieldValue('title', 'title') ?? '')} onChange={event => setField('title', event.target.value.trim() || null)} /></label>
        {fieldEditable('estimated_minutes', 'number') && <label className="block text-sm">Estimated minutes<Input type="number" min={0} max={1440} step={1} value={String(fieldValue('estimatedMinutes', 'estimated_minutes') ?? '')}
          onChange={event => setField('estimatedMinutes', event.target.value === '' ? Number.NaN : Number(event.target.value))} /></label>}
        {fieldEditable('activity_type', 'string') && <label className="block text-sm">Activity<select className="ml-2 rounded border bg-background p-2" value={String(fieldValue('activityType', 'activity_type') ?? '')}
          onChange={event => setField('activityType', event.target.value)}><option value="">Choose activity</option>{ACTIVITY_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>}
        {([['content', 'content', 'text', 'Lesson text'], ['transcript', 'transcript', 'video', 'Transcript'], ['attestationText', 'attestation_text', 'attestation', 'Attestation statement'],
          ['attestationVersion', 'attestation_version', 'attestation', 'Attestation version']] as const).filter(([, , type]) => type === lessonType).map(([key, native, , label]) => fieldEditable(native, 'string')
          ? <label key={key} className="block text-sm">{label}<Textarea rows={key === 'attestationVersion' ? 1 : 5} maxLength={key === 'attestationVersion' ? 128 : 12000}
            value={String(fieldValue(key, native) ?? '')} onChange={event => setField(key, event.target.value)} /></label> : <p key={key} className="text-sm">Legacy {label.toLowerCase()} is preserved for native reconciliation.</p>)}
      </>}
      {change.operation === 'configureQuiz' && <>
        <label className="block text-sm">Quiz title<Input maxLength={300} value={change.title} onChange={event => setChange({ ...change, title: event.target.value })} /></label>
        <label className="block text-sm">Quiz kind<select className="ml-2 rounded border bg-background p-2" value={change.kind}
          onChange={event => setChange({ ...change, kind: event.target.value as typeof change.kind, revealsAnswersAfterAttempt: false })}>
          {['assessment', 'knowledge_check', 'final_exam'].map(kind => <option key={kind}>{kind}</option>)}</select></label>
        <label className="block text-sm">Passing score (%)<Input type="number" min={0} max={100} step={1} value={change.passingScore} onChange={event => setChange({ ...change, passingScore: Number(event.target.value) })} /></label>
        <label className="block text-sm">Maximum attempts (blank means unlimited)<Input type="number" min={1} max={2147483647} step={1} value={change.maxAttempts ?? ''} onChange={event => setChange({ ...change, maxAttempts: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        {(['shuffleQuestions', 'shuffleAnswers', 'revealsAnswersAfterAttempt'] as const).map(key => <label key={key} className="flex gap-2 text-sm"><input type="checkbox" checked={change[key]}
          disabled={key === 'revealsAnswersAfterAttempt' && change.kind !== 'knowledge_check'} onChange={event => setChange({ ...change, [key]: event.target.checked })} />
          {key === 'shuffleQuestions' ? 'Shuffle questions' : key === 'shuffleAnswers' ? 'Shuffle answers' : 'Reveal answers after a knowledge check'}</label>)}
      </>}
      {change.operation === 'saveQuestion' && <>
        <label className="block text-sm">Question<Textarea maxLength={12000} value={change.prompt} onChange={event => setChange({ ...change, prompt: event.target.value })} /></label>
        <label className="block text-sm">Question type<select className="ml-2 rounded border bg-background p-2" value={change.type}
          onChange={event => setChange({ ...change, type: event.target.value as typeof change.type })}>{['single_choice', 'multiple_choice', 'true_false'].map(type => <option key={type}>{type}</option>)}</select></label>
        <label className="block text-sm">Points<Input type="number" min={1} max={2147483647} step={1} value={change.points} onChange={event => setChange({ ...change, points: Number(event.target.value) })} /></label>
        <label className="block text-sm">Topic code<Input maxLength={128} value={change.topicCode ?? ''} onChange={event => setChange({ ...change, topicCode: event.target.value || null })} /></label>
        <label className="block text-sm">Topic label<Input maxLength={300} value={change.topicLabel ?? ''} onChange={event => setChange({ ...change, topicLabel: event.target.value || null })} /></label>
        <label className="block text-sm">Author explanation<Textarea maxLength={12000} value={change.explanation ?? ''} onChange={event => setChange({ ...change, explanation: event.target.value || null })} /></label>
        <p className="text-sm">Choose {change.type === 'multiple_choice' ? 'one or more correct answers' : 'exactly one correct answer'}. The learner receives answer choices through the existing protected quiz flow.</p>
        {change.answers.map((answer, index) => <div key={answer.answerId} className="space-y-2 rounded border p-2">
          <label className="block text-sm">Answer {index + 1}<Textarea rows={2} maxLength={12000} value={answer.text} onChange={event => setChange({ ...change, answers: change.answers.map(row => row.answerId === answer.answerId ? { ...row, text: event.target.value } : row) })} /></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={answer.correct} onChange={event => setChange({ ...change, answers: change.answers.map(row => row.answerId === answer.answerId
            ? { ...row, correct: event.target.checked } : change.type !== 'multiple_choice' && event.target.checked ? { ...row, correct: false } : row) })} />Correct answer</label>
          <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setChange(removeAnswer(change, answer.answerId, question))}>Remove answer</Button>
            {([-1, 1] as const).map(direction => <Button variant="ghost" size="sm" key={direction} disabled={index + direction < 0 || index + direction >= change.answers.length}
              onClick={() => { const answers = [...change.answers]; [answers[index], answers[index + direction]] = [answers[index + direction], answers[index]]; setChange({ ...change, answers }); }}>{direction < 0 ? 'Move up' : 'Move down'}</Button>)}</div>
        </div>)}
        <Button variant="outline" disabled={change.answers.length >= 100} onClick={() => setChange({ ...change, answers: [...change.answers, { answerId: id(), text: '', correct: false }] })}>Add answer</Button>
      </>}
      <details open={removed.length > 0}><summary className="cursor-pointer font-medium">Review exact changes and removal identifiers</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap p-2 text-xs">{JSON.stringify(changes, null, 2)}</pre></details>
      {removed.length > 0 && <label className="flex gap-2 text-sm"><input type="checkbox" checked={removalReviewed} onChange={event => setRemovalReviewed(event.target.checked)} />I reviewed these explicit removals and their descendant definitions.</label>}
      <label className="block text-sm">Reason for this change<Textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {!valid && <p className="text-sm">Complete the fields and answer key. Each change is limited to 24 KiB.</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={locked || !valid || reason.trim().length < 10 || removed.length > 0 && !removalReviewed} onClick={() => void save()}>Save reviewed structure change</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setChange(null); request.current = null; }}>Discard change</Button></div>
    </fieldset>}
  </section>;
}
