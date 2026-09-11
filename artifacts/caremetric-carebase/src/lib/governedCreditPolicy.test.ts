import { describe, expect, it } from 'vitest';
import { canonicalCreditHours, creditPolicyChange, creditPolicyForm, validCreditPolicyParameters, type CreditPolicySource } from './governedCreditPolicy';
import { validCreditPolicyChange, type CreditDefinition } from '../../../../supabase/functions/_shared/learningCreditPolicy';
import type { GovernedDraftSource } from './governedLearningDraft';
const id = (n: number) => `ade00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row: CreditDefinition = { creditId: id(1), trainingTypeId: id(2), topicCode: 'SAFETY.A', creditHours: '1.25', creditMode: 'automatic', citationNote: 'Reviewed source citation', isActive: true };
const source: CreditPolicySource = { versionLabel: null, creditedDurationRationale: null, credits: [row] };
describe('governed credit definition form', () => {
  it('represents exact decimal cents without floating point conversion', () => {
    expect(canonicalCreditHours('9999.99')).toBe('9999.99'); expect(canonicalCreditHours('1')).toBe('1.00'); expect(canonicalCreditHours('0.1')).toBe('0.10'); expect(canonicalCreditHours('1e2')).toBe('1e2');
  });
  it('preserves legacy definitions by ID and omits untouched metadata', () => {
    const legacy = { ...source, versionLabel: 'x'.repeat(500), credits: [{ ...row, citationNote: 'x'.repeat(20000) }] };
    const form = creditPolicyForm(legacy); expect(creditPolicyChange(legacy, form)).toBeNull();
    form.creditedDurationRationale = 'Reviewed rationale for designed instructional duration.';
    const change = creditPolicyChange(legacy, form)!;
    expect(change.credits).toEqual([{ creditId: row.creditId, preserve: true }]); expect(change.policy).not.toHaveProperty('versionLabel'); expect(validCreditPolicyChange(change)).toBe(true);
  });
  it('preserves original IDs across edit/undo and lists only actual removals', () => {
    const form = creditPolicyForm(source); form.credits[0].creditHours = '1.50';
    expect(creditPolicyChange(source, form)?.credits[0]).toMatchObject({ creditId: id(1), creditHours: '1.50' });
    form.credits[0].creditHours = row.creditHours; expect(creditPolicyChange(source, form)).toBeNull();
    form.credits.push({ ...row, creditId: id(3), trainingTypeId: id(4) }); form.credits = form.credits.filter(item => item.creditId !== id(3)); expect(creditPolicyChange(source, form)).toBeNull();
    form.credits = []; expect(creditPolicyChange(source, form)?.removedCreditIds).toEqual([id(1)]);
  });
  it('requires explicit canonical, bounded complete definitions', () => {
    const value = { policy: {}, credits: [row], removedCreditIds: [] }; expect(validCreditPolicyChange(value)).toBe(true);
    for (const patch of [{ creditHours: 1 }, { creditHours: '0.00' }, { creditHours: '1.2' }, { creditHours: '10000.00' }, { creditHours: '1e2' },
      { citationNote: '\n\t' }, { citationNote: 'https://example.test?token=excluded' }, { topicCode: 'lowercase' }, { isActive: 'true' }, { providerApproval: true }]) {
      expect(validCreditPolicyChange({ ...value, credits: [{ ...row, ...patch }] })).toBe(false);
    }
    expect(validCreditPolicyChange({ ...value, credits: [{ ...row, creditId: id(1).toUpperCase(), trainingTypeId: id(2).toUpperCase() }] })).toBe(true);
    expect(validCreditPolicyChange({ ...value, removedCreditIds: [id(1).toUpperCase()] })).toBe(false);
    expect(validCreditPolicyChange({ ...value, credits: [row, { ...row, creditId: id(3) }] })).toBe(false);
    expect(validCreditPolicyChange({ ...value, policy: { creditedDurationRationale: '\n'.repeat(50) } })).toBe(false);
  });
  it('bounds the whole parameters envelope, including immutable source identity', () => {
    const change = { policy: { creditedDurationRationale: 'x'.repeat(12000) }, credits: [{ ...row, citationNote: 'x'.repeat(12000) }], removedCreditIds: [] };
    const envelope = { versionId: id(5), sourceRevision: 'a'.repeat(64) } as GovernedDraftSource;
    expect(validCreditPolicyParameters(envelope, change)).toBe(true);
    const expanded = { ...change, credits: [...change.credits, { ...row, creditId: id(6), trainingTypeId: id(7), citationNote: 'x'.repeat(500) }] };
    expect(validCreditPolicyParameters(envelope, expanded)).toBe(false);
  });
});
