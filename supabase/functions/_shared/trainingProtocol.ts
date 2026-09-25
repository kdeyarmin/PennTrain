/** Shared, dependency-free contract for the delegated CareBase training workspace. */
export const trainingDomain = 'training.v1' as const;
export const trainingModules = ['modules.train','modules.workforce','modules.compliance','modules.billing','modules.carebase'] as const;
export const enrollmentStatuses = ['all','assigned','in_progress','completed','overdue','paused','canceled'] as const;
export type TrainingModule = typeof trainingModules[number];
export type EnrollmentStatus = typeof enrollmentStatuses[number];
export type TrainingDateBasis = 'assigned'|'completed'|'certificate';
type Scope = { domain: typeof trainingDomain; organizationId: string };
type Page = { search: string; limit: number; offset: number };
export type TrainingParameters = {
  'facilities.provision': { organizationName: string; facilityName: string; facilityType: 'PCH'|'ALR' };
  'students.create': { facilityId: string; firstName: string; lastName: string; email: string|null; jobTitle: string; hireDate: string };
  'students.update': { employeeId: string; firstName: string; lastName: string; email: string|null; jobTitle: string };
  'students.setActive': { employeeId: string; active: boolean; effectiveDate: string };
  'enrollments.assign': { employeeId: string; courseId: string; versionId: string; dueDate: string|null };
  'enrollments.cancel': { assignmentId: string };
  'access.grant': { moduleKey: TrainingModule; source: 'complimentary'|'contract'; endsAt: string|null };
  'access.revoke': { termId: string };
  'invitations.create': { role: 'org_admin'|'employee'; firstName: string; lastName: string; email: string; facilityId: string|null; employeeId: string|null };
};
export type TrainingAction = keyof TrainingParameters;
export type TrainingCommand = { [A in TrainingAction]: { domain: typeof trainingDomain; operation: 'apply'; action: A; requestId: string; organizationId: string|null; parameters: TrainingParameters[A]; reason: string } }[TrainingAction];
export type TrainingReportOperation = Scope & { operation: 'enrollments.report'; facilityId: string|null; courseSearch: string; status: EnrollmentStatus; dateBasis: TrainingDateBasis; dateFrom: string|null; dateThrough: string|null; limit: number; offset: number };
export type TrainingOperation = TrainingCommand | TrainingReportOperation
  | (Scope & Page & { operation:'facilities.list'|'courses.list' })
  | (Scope & Page & { operation:'students.list'; facilityId:string; status:'all'|'active'|'inactive' })
  | (Scope & { operation:'access.list'; limit:number; offset:number })
  | (Scope & { operation:'certificates.read'; certificateId:string });
export interface TrainingFacility { id:string; name:string; facilityType:'PCH'|'ALR'; isActive:boolean }
export interface TrainingStudent { id:string; firstName:string; lastName:string; email:string|null; jobTitle:string; hireDate:string|null; isActive:boolean; status:string; profileId:string|null }
export interface TrainingCourse { id:string; title:string; versionId:string|null }
export interface TrainingTerm { id:string; moduleKey:TrainingModule; source:'complimentary'|'contract'; startsAt:string; endsAt:string|null; revokedAt:string|null; reason:string }
export interface TrainingPage<T> { items:T[]; total:number; limit:number; offset:number }
export interface TrainingEnrollmentRow {
  id:string; employee_id:string; student:string; facility_id:string; facility:string; course_id:string; course:string; status:string;
  assigned_at:string; due_date:string|null; completed_at:string|null; percent_complete:number; certificate_id:string|null;
  credential_number:string|null; certificate_issued_at:string|null; certificate_pdf_status:string|null;
}
export interface TrainingEnrollmentPage {
  organization_name:string; facility_name:string|null; generated_at:string; date_basis:TrainingDateBasis;
  limit:number; offset:number; total:number; students:number; completed:number; in_progress:number; not_started:number;
  canceled:number; completion_denominator:number; certificates:number; rows:TrainingEnrollmentRow[];
}
export interface TrainingCertificate { certificateId:string; status:'pending'|'processing'|'ready'|'failed'; url:string|null; expiresAt:string|null }
export interface TrainingCommandResult { requestId:string; action:TrainingAction; organizationId:string; replayed:boolean; result:Record<string, string|boolean|null> }
export type TrainingResponse = TrainingPage<TrainingFacility>|TrainingPage<TrainingStudent>|TrainingPage<TrainingCourse>|TrainingPage<TrainingTerm>|TrainingEnrollmentPage|TrainingCertificate|TrainingCommandResult;
function bad(): never { throw new Error('Invalid training contract'); }
const object = (v:unknown):Record<string,unknown> => v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:bad();
const only = (v:Record<string,unknown>,keys:string[]) => { if(Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))bad(); };
const str = (v:unknown,max=500,min=0):string => typeof v==='string'&&v.length<=max&&v.length>=min&&!Array.from(v).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)?v:bad();
const uuid = (v:unknown):string => typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)?v.toLowerCase():bad();
const nullable = <T>(v:unknown,read:(v:unknown)=>T):T|null => v===null?null:read(v);
const num = (v:unknown,max=Number.MAX_SAFE_INTEGER):number => typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max?v:bad();
const bool = (v:unknown):boolean => typeof v==='boolean'?v:bad();
const choice = <T extends string>(v:unknown,choices:readonly T[]):T => choices.includes(v as T)?v as T:bad();
const day = (v:unknown):string => { const s=str(v,10,10); return /^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:bad(); };
const instant = (v:unknown):string => { const s=str(v,40,20); return /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s))?s:bad(); };
const email = (v:unknown):string => { const s=str(v,320,3); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:bad(); };
const named = (v:unknown,max=200):string => { const s=str(v,max,1); return s===s.trim()?s:bad(); };

export function parseTrainingOperation(input:unknown):TrainingOperation {
  const r=object(input); if(r.domain!==trainingDomain)bad();
  const base={domain:trainingDomain};
  if(r.operation==='apply'){
    only(r,['domain','operation','requestId','action','organizationId','parameters','reason']);
    const action=choice(r.action,['facilities.provision','students.create','students.update','students.setActive','enrollments.assign','enrollments.cancel','access.grant','access.revoke','invitations.create'] as const);
    const p=object(r.parameters); let parameters:TrainingParameters[TrainingAction];
    if(action==='facilities.provision'){only(p,['organizationName','facilityName','facilityType']);parameters={organizationName:named(p.organizationName),facilityName:named(p.facilityName),facilityType:choice(p.facilityType,['PCH','ALR'])};}
    else if(action==='students.create'){only(p,['facilityId','firstName','lastName','email','jobTitle','hireDate']);parameters={facilityId:uuid(p.facilityId),firstName:named(p.firstName,100),lastName:named(p.lastName,100),email:nullable(p.email,email),jobTitle:named(p.jobTitle),hireDate:day(p.hireDate)};}
    else if(action==='students.update'){only(p,['employeeId','firstName','lastName','email','jobTitle']);parameters={employeeId:uuid(p.employeeId),firstName:named(p.firstName,100),lastName:named(p.lastName,100),email:nullable(p.email,email),jobTitle:named(p.jobTitle)};}
    else if(action==='students.setActive'){only(p,['employeeId','active','effectiveDate']);parameters={employeeId:uuid(p.employeeId),active:bool(p.active),effectiveDate:day(p.effectiveDate)};}
    else if(action==='enrollments.assign'){only(p,['employeeId','courseId','versionId','dueDate']);parameters={employeeId:uuid(p.employeeId),courseId:uuid(p.courseId),versionId:uuid(p.versionId),dueDate:nullable(p.dueDate,day)};}
    else if(action==='enrollments.cancel'){only(p,['assignmentId']);parameters={assignmentId:uuid(p.assignmentId)};}
    else if(action==='access.grant'){only(p,['moduleKey','source','endsAt']);parameters={moduleKey:choice(p.moduleKey,trainingModules),source:choice(p.source,['complimentary','contract']),endsAt:nullable(p.endsAt,instant)};}
    else if(action==='access.revoke'){only(p,['termId']);parameters={termId:uuid(p.termId)};}
    else {only(p,['role','firstName','lastName','email','facilityId','employeeId']);const role=choice(p.role,['org_admin','employee']);parameters={role,firstName:named(p.firstName,100),lastName:named(p.lastName,100),email:email(p.email),facilityId:nullable(p.facilityId,uuid),employeeId:nullable(p.employeeId,uuid)};
      if(role==='employee'&&(!parameters.facilityId||!parameters.employeeId)||role==='org_admin'&&(parameters.facilityId!==null||parameters.employeeId!==null))bad();}
    const organizationId=action==='facilities.provision'?(r.organizationId===null?null:bad()):uuid(r.organizationId);
    const reason=named(r.reason,500);if(reason.length<10)bad();
    return {...base,operation:'apply',requestId:uuid(r.requestId),action,organizationId,parameters,reason} as TrainingCommand;
  }
  const scope={...base,organizationId:uuid(r.organizationId)};
  if(r.operation==='access.list'){only(r,['domain','operation','organizationId','limit','offset']);const limit=num(r.limit,100);if(limit<1)bad();return {...scope,operation:r.operation,limit,offset:num(r.offset,1000000)};}
  if(r.operation==='certificates.read'){only(r,['domain','operation','organizationId','certificateId']);return {...scope,operation:r.operation,certificateId:uuid(r.certificateId)};}
  if(r.operation==='enrollments.report'){
    only(r,['domain','operation','organizationId','facilityId','courseSearch','status','dateBasis','dateFrom','dateThrough','limit','offset']);
    const limit=num(r.limit,10000),offset=num(r.offset,1000000),dateFrom=nullable(r.dateFrom,day),dateThrough=nullable(r.dateThrough,day);
    if(limit<1||(limit>500&&limit!==10000)||(limit===10000&&offset!==0)||(dateFrom&&dateThrough&&dateFrom>dateThrough))bad();
    return {...scope,operation:r.operation,facilityId:nullable(r.facilityId,uuid),courseSearch:str(r.courseSearch,200),status:choice(r.status,enrollmentStatuses),dateBasis:choice(r.dateBasis,['assigned','completed','certificate']),dateFrom,dateThrough,limit,offset};
  }
  const operation=choice(r.operation,['facilities.list','students.list','courses.list']);
  only(r,['domain','operation','organizationId','search','limit','offset',...(operation==='students.list'?['facilityId','status']:[])]);
  const limit=num(r.limit,100);if(limit<1)bad();const page={search:str(r.search,100),limit,offset:num(r.offset,1000000)};
  if(operation==='students.list')return {...scope,...page,operation,facilityId:uuid(r.facilityId),status:choice(r.status,['all','active','inactive'])};
  return {...scope,...page,operation};
}

function page<T>(r:Record<string,unknown>,op:{limit:number;offset:number},project:(v:unknown)=>T):TrainingPage<T>{
  if(r.limit!==op.limit||r.offset!==op.offset||!Array.isArray(r.items))bad();
  const total=num(r.total);if(r.items.length!==Math.min(op.limit,Math.max(0,total-op.offset)))bad();
  const items=r.items.map(project);if(new Set(items.map(x=>(x as {id:string}).id)).size!==items.length)bad();
  return {items,total,limit:op.limit,offset:op.offset};
}
export function projectTrainingResponse(input:unknown,op:TrainingOperation,certificateOrigin='https://xsqobvvreaovwibxwyvv.supabase.co',now=Date.now()):TrainingResponse {
  const r=object(input);
  if(op.operation==='facilities.list')return page(r,op,v=>{const x=object(v);return {id:uuid(x.id),name:str(x.name),facilityType:choice(x.facilityType,['PCH','ALR']),isActive:bool(x.isActive)};});
  if(op.operation==='students.list')return page(r,op,v=>{const x=object(v);return {id:uuid(x.id),firstName:str(x.firstName,100),lastName:str(x.lastName,100),email:nullable(x.email,email),jobTitle:str(x.jobTitle),hireDate:nullable(x.hireDate,day),isActive:bool(x.isActive),status:str(x.status,80),profileId:nullable(x.profileId,uuid)};});
  if(op.operation==='courses.list')return page(r,op,v=>{const x=object(v);return {id:uuid(x.id),title:str(x.title,1000),versionId:nullable(x.versionId,uuid)};});
  if(op.operation==='access.list'){
    return page(r,op,v=>{const x=object(v);return {id:uuid(x.id),moduleKey:choice(x.moduleKey,trainingModules),source:choice(x.source,['complimentary','contract']),startsAt:instant(x.startsAt),endsAt:nullable(x.endsAt,instant),revokedAt:nullable(x.revokedAt,instant),reason:str(x.reason,1000)};});
  }
  if(op.operation==='certificates.read'){
    const certificateId=uuid(r.certificateId),status=choice(r.status,['pending','processing','ready','failed']);
    if(certificateId!==op.certificateId)bad();
    const url=nullable(r.url,v=>str(v,4096)),expiresAt=nullable(r.expiresAt,instant);
    if(status==='ready'){
      if(!url||!expiresAt)bad();const parsed=new URL(url);
      if(parsed.protocol!=='https:'||parsed.origin!==certificateOrigin||parsed.port||parsed.username||parsed.password||parsed.hash||parsed.pathname!==`/storage/v1/object/sign/certificates/${op.organizationId}/${op.certificateId}.pdf`||!parsed.searchParams.get('token'))bad();
      // Native signs for ten minutes. Permit one minute of clock skew, never an
      // already-expired response or an unbounded bearer link.
      const remaining=Date.parse(expiresAt)-now;if(!Number.isFinite(remaining)||remaining<=0||remaining>660_000)bad();
    }else if(url!==null||expiresAt!==null)bad();
    return {certificateId,status,url,expiresAt};
  }
  if(op.operation==='enrollments.report'){
    if(r.limit!==op.limit||r.offset!==op.offset||r.date_basis!==op.dateBasis||!Array.isArray(r.rows))bad();
    const counts={total:num(r.total),students:num(r.students),completed:num(r.completed),in_progress:num(r.in_progress),not_started:num(r.not_started),canceled:num(r.canceled),completion_denominator:num(r.completion_denominator),certificates:num(r.certificates)};
    if(r.rows.length!==Math.min(op.limit,Math.max(0,counts.total-op.offset))||op.limit===10000&&counts.total>10000||counts.completion_denominator!==counts.total-counts.canceled||counts.completed>counts.completion_denominator||counts.students>counts.total||counts.certificates>counts.total)bad();
    const rows=r.rows.map(v=>{const x=object(v),percent=x.percent_complete;if(typeof percent!=='number'||!Number.isFinite(percent)||percent<0||percent>100)bad();
      const facility_id=uuid(x.facility_id);if(op.facilityId&&facility_id!==op.facilityId)bad();
      if(op.status!=='all'&&x.status!==op.status)bad();
      if(op.dateBasis==='certificate'&&(!x.certificate_id||!x.certificate_issued_at))bad();
      return {id:uuid(x.id),employee_id:uuid(x.employee_id),student:str(x.student,500),facility_id,facility:str(x.facility,500),course_id:uuid(x.course_id),course:str(x.course,1000),status:choice(x.status,enrollmentStatuses.slice(1)),assigned_at:instant(x.assigned_at),due_date:nullable(x.due_date,day),completed_at:nullable(x.completed_at,instant),percent_complete:percent,certificate_id:nullable(x.certificate_id,uuid),credential_number:nullable(x.credential_number,v=>str(v,200)),certificate_issued_at:nullable(x.certificate_issued_at,instant),certificate_pdf_status:nullable(x.certificate_pdf_status,v=>str(v,80))};});
    if(new Set(rows.map(x=>x.id)).size!==rows.length)bad();
    return {...counts,organization_name:str(r.organization_name),facility_name:nullable(r.facility_name,v=>str(v)),generated_at:instant(r.generated_at),date_basis:op.dateBasis,limit:op.limit,offset:op.offset,rows};
  }
  if(op.operation!=='apply')return bad();
  const requestId=uuid(r.requestId),action=choice(r.action,[op.action]),organizationId=uuid(r.organizationId),replayed=bool(r.replayed),value=object(r.result);
  if(requestId!==op.requestId||op.organizationId!==null&&organizationId!==op.organizationId)bad();
  let result:TrainingCommandResult['result'];
  if(action==='facilities.provision'){result={organizationId:uuid(value.organizationId),facilityId:uuid(value.facilityId)};if(result.organizationId!==organizationId)bad();}
  else if(action.startsWith('students.')){result={employeeId:uuid(value.employeeId)};if('employeeId' in op.parameters&&result.employeeId!==op.parameters.employeeId)bad();}
  else if(action==='enrollments.assign')result={assignmentId:uuid(value.assignmentId),alreadyAssigned:bool(value.alreadyAssigned)};
  else if(action==='enrollments.cancel'){result={assignmentId:uuid(value.assignmentId)};if('assignmentId' in op.parameters&&result.assignmentId!==op.parameters.assignmentId)bad();}
  else if(action.startsWith('access.')){result={termId:uuid(value.termId)};if('termId' in op.parameters&&result.termId!==op.parameters.termId)bad();}
  else {result={invitationId:nullable(value.invitationId,uuid),deliveryStatus:choice(value.deliveryStatus,['queued','sent','failed','unknown'])};if(result.deliveryStatus==='sent'&&!result.invitationId)bad();}
  return {requestId,action,organizationId,replayed,result};
}
