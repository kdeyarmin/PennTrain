import { describe, it, expect } from 'vitest';
import { compliancePercent, scoreQuiz } from './caremetricData';
import { buildComplianceBinderHtml, toCsv } from './caremetricExports';

describe('scoreQuiz', () => {
  it('returns 100% and passes when all answers are correct', () => {
    const result = scoreQuiz([true, true, true], 80);
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });

  it('returns correct score and fails when below threshold', () => {
    const result = scoreQuiz([true, false, false, false], 80);
    expect(result.score).toBe(25);
    expect(result.passed).toBe(false);
  });
});

describe('compliancePercent', () => {
  it('rounds correctly', () => {
    expect(compliancePercent([{ overdue: 0 }, { overdue: 1 }, { overdue: 0 }])).toBe(67);
  });
});

describe('toCsv', () => {
  it('includes headers in output', () => {
    expect(toCsv([{ staff: 'Avery', status: 'complete' }])).toContain('staff,status');
  });
});

describe('buildComplianceBinderHtml', () => {
  it('renders title in binder HTML', () => {
    const html = buildComplianceBinderHtml({
      organization: 'Demo',
      facility: 'Oakview',
      dateRange: '2026',
      sections: ['Training'],
      generatedAt: 'now',
      summary: 'ready',
    });
    expect(html).toContain('Compliance Binder');
  });
});
