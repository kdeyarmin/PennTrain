export type Status = 'current' | 'due_soon' | 'overdue' | 'complete' | 'pending' | 'approved' | 'expired';
export const complianceDisclaimer = 'Compliance templates are configurable tools for documentation and tracking. The facility is responsible for verifying current federal, state, and local requirements and confirming whether specific training is accepted by the applicable regulatory agency.';
export const courseCategories = ['Personal Care Home Orientation','Resident Rights','Abuse, Neglect, and Exploitation','Dementia Care','Infection Control','Fire Safety','Emergency Preparedness','Medication Administration Tracking','HIPAA and Confidentiality','Incident Reporting','Falls Prevention','Nutrition and Hydration','Behavioral Health','Documentation','Staff Competency','OSHA / Workplace Safety','Administrator Training','Direct Care Staff Training','Annual In-Service Training'];
export const courses = [
 { id:'c1', title:'Resident Rights and Dignity Essentials', category:'Resident Rights', type:'reading + quiz', duration:45, hours:.75, version:'1.0', status:'published', renewal:'Annual', required:true, pass:80, completions:42, tags:['rights','orientation'] },
 { id:'c2', title:'Recognizing and Reporting Abuse or Neglect', category:'Abuse, Neglect, and Exploitation', type:'video + attestation', duration:60, hours:1, version:'1.1', status:'published', renewal:'Annual', required:true, pass:80, completions:38, tags:['abuse','reporting'] },
 { id:'c3', title:'Infection Control for Personal Care Settings', category:'Infection Control', type:'quiz', duration:50, hours:1, version:'2.0-draft', status:'draft', renewal:'Annual', required:true, pass:85, completions:31, tags:['osha','ppe'] },
 { id:'c4', title:'Medication Administration Documentation Tracker', category:'Medication Administration Tracking', type:'external certificate', duration:30, hours:.5, version:'1.0', status:'published', renewal:'Annual', required:true, pass:null, completions:21, tags:['medication','certificate'] },
];
export const staff = [
 { id:'s1', name:'Avery Johnson', role:'Direct Care Staff', facility:'Oakview Personal Care', compliance:94, hours:13.5, overdue:0, hireDate:'2026-02-12', med:'current' as Status },
 { id:'s2', name:'Morgan Lee', role:'Medication Technician', facility:'Oakview Personal Care', compliance:82, hours:10, overdue:1, hireDate:'2025-09-04', med:'due_soon' as Status },
 { id:'s3', name:'Riley Patel', role:'Administrator', facility:'Riverbend Assisted Living', compliance:76, hours:18, overdue:2, hireDate:'2024-05-18', med:'expired' as Status },
 { id:'s4', name:'Jordan Smith', role:'Direct Care Staff', facility:'Riverbend Assisted Living', compliance:100, hours:14, overdue:0, hireDate:'2026-06-03', med:'pending' as Status },
];
export const requirements = [
 { name:'Administrator annual training tracking', category:'Administrator Training', roles:['Administrator'], hours:24, renewal:'Annual', evidence:['course','external certificate','in-service'], courses:['c1'], citation:'Configurable PA PCH/Chapter 2600-style sample; verify current law.' },
 { name:'Direct care staff annual training tracking', category:'Direct Care Staff Training', roles:['Direct Care Staff','Medication Technician'], hours:12, renewal:'Annual', evidence:['course','competency','in-service'], courses:['c1','c2','c3'], citation:'Configurable sample, not legal advice.' },
 { name:'Medication administration certification tracking', category:'Medication Administration Tracking', roles:['Medication Technician'], hours:0, renewal:'Annual', evidence:['external certificate','observation checklist'], courses:['c4'], citation:'Track documentation only unless configured otherwise.' },
 { name:'New employee orientation', category:'Personal Care Home Orientation', roles:['All Staff'], hours:3, renewal:'Once', evidence:['course','attestation'], courses:['c1','c2'], citation:'Editable onboarding requirement.' },
];
export const assignments = [
 { staff:'Avery Johnson', course:'Resident Rights and Dignity Essentials', due:'2026-07-20', status:'in progress', score:null },
 { staff:'Morgan Lee', course:'Recognizing and Reporting Abuse or Neglect', due:'2026-07-01', status:'overdue', score:72 },
 { staff:'Riley Patel', course:'Infection Control for Personal Care Settings', due:'2026-07-15', status:'not started', score:null },
 { staff:'Jordan Smith', course:'Resident Rights and Dignity Essentials', due:'2026-06-25', status:'completed', score:94 },
];
export const medications = [
 { staff:'Morgan Lee', original:'2025-08-01', renewal:'2026-08-01', expiration:'2026-08-31', trainer:'Dana Brooks', status:'due_soon' as Status, docs:true },
 { staff:'Riley Patel', original:'2024-01-15', renewal:'2026-01-15', expiration:'2026-02-14', trainer:'State-approved provider', status:'expired' as Status, docs:false },
];
export const competencies = [
 { template:'Direct care competency', staff:'Avery Johnson', observedBy:'Casey Nguyen, RN', date:'2026-06-18', result:'pass', reobserve:'2027-06-18' },
 { template:'Medication observation checklist', staff:'Morgan Lee', observedBy:'Dana Brooks', date:'2026-05-10', result:'pass', reobserve:'2026-08-10' },
 { template:'Transfer/ambulation assistance', staff:'Jordan Smith', observedBy:'Casey Nguyen, RN', date:'2026-07-02', result:'pending', reobserve:'2026-07-16' },
];
export const inservices = [
 { title:'Fire Safety Drill and Evacuation Review', instructor:'Sam Carter', facility:'Oakview Personal Care', when:'2026-07-12 10:00', hours:1, attendees:18, complete:12 },
 { title:'Dementia Care Communication Techniques', instructor:'Dana Brooks', facility:'Riverbend Assisted Living', when:'2026-07-19 14:00', hours:1.5, attendees:22, complete:0 },
];
export const externalRecords = [
 { name:'DHS-approved medication update certificate', staff:'Morgan Lee', issuer:'External training provider', completed:'2026-06-20', expires:'2026-08-31', hours:2, status:'pending' as Status },
 { name:'CPR / First Aid', staff:'Avery Johnson', issuer:'Community Health Training', completed:'2026-05-04', expires:'2028-05-04', hours:4, status:'approved' as Status },
];
export function scoreQuiz(answers:boolean[], passing=80){ const correct=answers.filter(Boolean).length; const score=Math.round((correct/Math.max(answers.length,1))*100); return {score, passed: score>=passing}; }
export function compliancePercent(items:{overdue:number}[]){ if(!items.length) return 100; return Math.round(items.filter(i=>i.overdue===0).length/items.length*100); }
