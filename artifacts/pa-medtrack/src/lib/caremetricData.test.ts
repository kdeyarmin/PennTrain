import { compliancePercent, scoreQuiz } from './caremetricData';
import { buildComplianceBinderHtml, toCsv } from './caremetricExports';

function assert(condition: unknown, message: string) { if (!condition) throw new Error(message); }
const perfect = scoreQuiz([true, true, true], 80);
assert(perfect.score === 100 && perfect.passed, 'perfect quiz should pass');
const failed = scoreQuiz([true, false, false, false], 80);
assert(failed.score === 25 && !failed.passed, 'low quiz score should fail');
assert(compliancePercent([{ overdue: 0 }, { overdue: 1 }, { overdue: 0 }]) === 67, 'compliance rounds correctly');
assert(toCsv([{ staff: 'Avery', status: 'complete' }]).includes('staff,status'), 'CSV export includes headers');
assert(buildComplianceBinderHtml({ organization: 'Demo', facility: 'Oakview', dateRange: '2026', sections: ['Training'], generatedAt: 'now', summary: 'ready' }).includes('Compliance Binder'), 'binder HTML renders title');
console.log('CareMetric calculation and export tests passed');
