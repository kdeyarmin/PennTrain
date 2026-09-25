import type { ReactElement, ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, effects: [] as (() => void)[], preview: vi.fn(), apply: vi.fn(), status: vi.fn(), refetch: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useId: () => 'provider',
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = initial; return [h.state[index], (v: unknown) => { h.state[index] = typeof v === 'function' ? v(h.state[index]) : v; }]; },
  useRef: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = { current: initial }; return h.state[index]; },
  useEffect: (effect: () => void, deps: unknown[]) => { const index = h.cursor++; const old = h.state[index] as unknown[] | undefined; if (!old || deps.some((v, i) => v !== old[i])) { h.state[index] = deps; h.effects.push(effect); } },
}));
const id = 'abc00000-0000-4000-8000-000000000004';
const context = { courseId: id, courseTitle: 'Course', courseStatus: 'draft', providerContextRevision: 'a'.repeat(64), impact: { versionCount: '2', legacyFallbackCertificates: '3', governedDrafts: [] },
  profile: { id: 'provider', providerFullName: 'Protected provider', courseAuthor: null, signatureName: null, signatureRecordedAt: null, contentVersion: null, lastClinicalReviewDate: null, reviewedBy: null, nextReviewDue: null, regulationReviewDate: null, reviewNotes: null } };
const currentProfile = { provider_full_name: 'Older display-cache value' };
const commands = { items: [{ commandId: 'command-original', expectedDigest: 'b'.repeat(64), expiresAt: '2099-01-01T00:00:00Z', appliedAt: null }], nextOffset: null };
vi.mock('@/hooks/useCourseProviderProfiles', () => ({ useGetCourseProviderProfile: () => ({ data: currentProfile, isLoading: false, isError: false, refetch: h.refetch }),
  useCourseProviderPolicy: () => ({ context: { data: context, isError: false, isFetching: false, refetch: h.refetch }, commands: { data: commands, isError: false },
    preview: { mutateAsync: h.preview, isPending: false }, apply: { mutateAsync: h.apply, isPending: false }, status: { mutateAsync: h.status, isPending: false } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { TrainingProviderCard } from './TrainingProviderCard';
type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== 'object' || !('props' in node)) return []; const n = node as Node; return [n, ...nodes(n.props.children as ReactNode)]; }
function text(node: ReactNode): string { if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(text).join(''); return node && typeof node === 'object' && 'props' in node ? text((node as Node).props.children as ReactNode) : ''; }
function render() { h.cursor = 0; const tree = TrainingProviderCard({ courseId: id, canManage: true }); const effects = h.effects.splice(0); effects.forEach(effect => effect()); return tree; }
function field(suffix: string) { return nodes(render()).find(n => n.props.id === `provider-${suffix}`)!; }
function input(suffix: string, value: string) { (field(suffix).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); }
function button(label: string) { return nodes(render()).find(n => typeof n.props.onClick === 'function' && text(n.props.children as ReactNode).includes(label))!; }
async function click(label: string) { const target = button(label); expect(target).toBeDefined(); expect(target.props.disabled).not.toBe(true); (target.props.onClick as () => void)(); await new Promise(resolve => setTimeout(resolve, 0)); }
const preview = { commandId: 'command-original', courseId: id, action: 'learning.editProviderPolicy', reason: 'Reviewed provider documentation', providerContextRevision: 'a'.repeat(64), previewDigest: 'b'.repeat(64), expiresAt: '2099-01-01T00:00:00Z', changes: [{ field: 'providerFullName', before: 'Protected provider', after: 'New provider' }], signatureTimestampAction: 'retain', impact: context.impact };
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.effects = []; h.cursor = 0; h.refetch.mockResolvedValue({ data: context }); render(); render(); });
it('hydrates editable values from the exact protected context rather than a stale display query', () => { expect(field('provider_full_name').props.value).toBe('Protected provider'); });
it('explicit preview keeps identical apply identity after a lost response', async () => {
  input('provider_full_name', 'New provider'); input('reason', preview.reason); h.preview.mockResolvedValue(preview);
  await click('Preview provider changes'); expect(text(render())).toContain('3 older certificates');
  h.apply.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({});
  await click('Apply reviewed provider changes'); expect(text(render())).toContain('Response lost');
  await click('Apply reviewed provider changes'); expect(h.apply).toHaveBeenCalledTimes(2); expect(h.apply.mock.calls[1][0]).toEqual(h.apply.mock.calls[0][0]);
});
it('preview retry retains request identity but changed material receives a new one', async () => {
  input('provider_full_name', 'New provider'); input('reason', preview.reason); h.preview.mockRejectedValue(new Error('Preview response lost'));
  await click('Preview provider changes'); await click('Preview provider changes'); expect(h.preview.mock.calls[1][0].requestId).toBe(h.preview.mock.calls[0][0].requestId);
  input('provider_full_name', 'Another provider'); await click('Preview provider changes'); expect(h.preview.mock.calls[2][0].requestId).not.toBe(h.preview.mock.calls[0][0].requestId);
});
it('a recovered command from another session is visible but cannot apply', async () => {
  h.status.mockResolvedValue({ preview, result: null, canApplyThisSession: false }); await click('Check command-');
  expect(text(render())).toContain('Refresh and review current values'); expect(button('Apply reviewed provider changes').props.disabled).toBe(true); expect(h.apply).not.toHaveBeenCalled();
});
