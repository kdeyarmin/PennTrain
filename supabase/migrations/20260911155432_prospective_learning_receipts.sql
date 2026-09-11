-- Prospective evidence bridge only: native completion remains the sole credit /
-- certificate writer. No historical assignments are bound or copied by migration.
create function app_private.learning_source_payload(p_course_id uuid,p_version_id uuid) returns text
language sql stable set search_path='' as $source$
with snapshots as (
  select c.id, jsonb_build_object(
    'contract','carebase.course.v1','sourceCourseId',c.id,'sourceVersionId',v.id,
    'sourceVersionNumber',v.version_number,'publicationState',c.status,'sourceVersionState',v.status,
    'course',jsonb_build_object('title',c.title,'description',c.description,'category',c.category,
      'estimatedDurationMinutes',c.estimated_duration_minutes,'catalogCode',c.catalog_code,
      'recurrenceIntervalDays',c.recurrence_interval_days,'legacyTrainingTypeId',c.training_type_id,
      'renewalTrainingTypeId',c.renewal_training_type_id,'creditedDurationCheckExempt',c.credited_duration_check_exempt),
    'version',jsonb_build_object('title',v.title,'description',v.description,'label',v.version_label,
      'contentStandard',v.content_standard,'creditedDurationRationale',v.credited_duration_rationale,
      'aiGenerated',v.ai_generated,'aiReviewedAt',v.ai_reviewed_at),
    'blocks',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'type',b.block_type,'sortOrder',b.sort_order,'title',b.title,'body',b.body,
      'documentId',b.document_id,'videoLocatorSha256',case when b.video_url is null then null
        else encode(extensions.digest(b.video_url,'sha256'),'hex') end,
      'quiz',(select jsonb_build_object('id',q.id,'title',q.title,'passingScore',q.passing_score_percent,
        'maxAttempts',q.max_attempts,'kind',q.quiz_kind,'shuffleQuestions',q.shuffle_questions,
        'shuffleAnswers',q.shuffle_answers,'revealsAnswersAfterAttempt',q.reveals_answers_after_attempt,
        'questions',coalesce((select jsonb_agg(jsonb_build_object('id',qq.id,'sortOrder',qq.sort_order,
          'prompt',qq.question_text,'type',qq.question_type,'points',qq.points,'topicCode',qq.topic_code,
          'topicLabel',qq.topic_label,'explanation',(select e.explanation from public.quiz_question_explanations e
            where e.question_id=qq.id and e.organization_id is null),
          'options',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'sortOrder',a.sort_order,
            'text',a.answer_text,'correct',a.is_correct) order by a.sort_order,a.id)
            from public.quiz_answers a where a.question_id=qq.id and a.organization_id is null),'[]'::jsonb)
        ) order by qq.sort_order,qq.id) from public.quiz_questions qq
        where qq.quiz_id=q.id and qq.organization_id is null),'[]'::jsonb))
      from public.quizzes q where q.course_block_id=b.id and q.organization_id is null)
    ) order by b.sort_order,b.id) from public.course_blocks b
      where b.course_version_id=v.id and b.organization_id is null),'[]'::jsonb),
    'credits',coalesce((select jsonb_agg(jsonb_build_object('id',cc.id,'trainingTypeId',cc.training_type_id,
      'topicCode',cc.topic_code,'creditHours',cc.credit_hours::text,'mode',cc.credit_mode,
      'citationNote',cc.citation_note,'active',cc.is_active) order by cc.id)
      from public.course_compliance_credits cc where cc.course_id=c.id and cc.course_version_id=v.id),'[]'::jsonb),
    'provider',(select jsonb_build_object('id',p.id,'fullName',p.provider_full_name,'professionalTitle',p.professional_title,
      'credential',p.credential,'credentialNumber',p.credential_number,'credentialIssuingOrganization',p.credential_issuing_organization,
      'credentialExpiresOn',p.credential_expires_on,'courseAuthor',p.course_author,'signatureName',p.provider_signature_name,
      'signatureRecordedAt',p.provider_signature_recorded_at,'contentVersion',p.content_version,
      'lastClinicalReviewDate',p.last_clinical_review_date,'reviewedBy',p.reviewed_by,'nextReviewDue',p.next_review_due,
      'regulationReviewDate',p.regulation_review_date,'reviewNotes',p.review_notes)
      from public.course_provider_profiles p where p.course_id=c.id),
    'packages',coalesce((select jsonb_agg(jsonb_build_object('id',lp.id,'standard',lp.standard_type,
      'contentSha256',lp.content_sha256,'entryPoint',lp.entry_point,'manifest',lp.manifest,'capabilities',lp.capabilities,
      'connectivityMode',lp.connectivity_mode,'validationStatus',lp.validation_status) order by lp.id)
      from public.learning_packages lp where lp.course_version_id=v.id and lp.organization_id is null),'[]'::jsonb)
  )::text as payload
  from public.courses c join public.course_versions v on v.id=p_version_id and v.course_id=c.id
  where c.id=p_course_id and c.organization_id is null and v.organization_id is null
)
select payload from snapshots;
$source$;

create function app_private.require_learning_bridge_actor(p_actor_id uuid,p_authentication_method text default 'jwt_aal2') returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if p_authentication_method is null or p_authentication_method not in ('jwt_aal2','app_sms') then raise exception 'Verified authentication method required.' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_actor_id and p.role='platform_admin' and p.is_active
      and not coalesce(u.is_anonymous,false) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'Active native platform administrator required.' using errcode='42501';
  end if;
end;
$$;

create table app_private.learning_source_policies (
  revision text primary key check(revision ~ '^[0-9a-f]{64}$'),
  course_id uuid not null,
  version_id uuid not null,
  payload text not null,
  observed_at timestamptz not null default now()
);
create table app_private.learning_receipt_mappings (
  id uuid primary key,
  organization_id uuid not null,
  employee_id uuid not null,
  native_profile_id uuid not null,
  hub_tenant_id uuid not null,
  hub_user_id uuid not null,
  course_id uuid not null,
  version_id uuid not null,
  source_revision text not null references app_private.learning_source_policies(revision),
  active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index learning_receipt_mapping_active on app_private.learning_receipt_mappings(employee_id,course_id) where active;
create table app_private.learning_assignment_bindings (
  assignment_id uuid primary key,
  mapping_id uuid not null references app_private.learning_receipt_mappings(id),
  assignment_revision text not null references app_private.learning_source_policies(revision),
  bound_at timestamptz not null default now()
);
create table app_private.learning_completion_evidence (
  assignment_id uuid primary key references app_private.learning_assignment_bindings(assignment_id),
  completion_revision text not null references app_private.learning_source_policies(revision),
  evidence jsonb not null,
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now()
);
create table app_private.learning_receipt_outbox (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references app_private.learning_completion_evidence(assignment_id),
  sequence integer not null check(sequence>0),
  kind text not null check(kind in ('completed','retracted')),
  payload text not null,
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check(state in ('pending','quarantined','delivered')),
  quarantine_reason text check(quarantine_reason in ('mapping_disabled','policy_drift','missing_renewal_evidence','binding_identity_drift','receipt_retracted')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique(assignment_id,sequence)
);
create index learning_receipt_outbox_pending on app_private.learning_receipt_outbox(created_at,id) where state<>'delivered';
create index learning_assignment_bindings_mapping on app_private.learning_assignment_bindings(mapping_id);
create index learning_source_policies_course on app_private.learning_source_policies(course_id);
create index learning_source_policies_version on app_private.learning_source_policies(version_id);
create index learning_receipt_mappings_org on app_private.learning_receipt_mappings(organization_id);
create index learning_receipt_mappings_tenant on app_private.learning_receipt_mappings(hub_tenant_id);
create index learning_receipt_mappings_course on app_private.learning_receipt_mappings(course_id);
create index learning_receipt_mappings_version on app_private.learning_receipt_mappings(version_id);
create index learning_receipt_mappings_source on app_private.learning_receipt_mappings(source_revision);
create index learning_receipt_mappings_actor on app_private.learning_receipt_mappings(created_by);
create index learning_receipt_mappings_employee on app_private.learning_receipt_mappings(employee_id);
create index learning_assignment_binding_revision on app_private.learning_assignment_bindings(assignment_revision);
create index learning_completion_evidence_revision on app_private.learning_completion_evidence(completion_revision);

alter table app_private.learning_source_policies enable row level security;
alter table app_private.learning_receipt_mappings enable row level security;
alter table app_private.learning_assignment_bindings enable row level security;
alter table app_private.learning_completion_evidence enable row level security;
alter table app_private.learning_receipt_outbox enable row level security;
revoke all on app_private.learning_source_policies,app_private.learning_receipt_mappings,app_private.learning_assignment_bindings,
  app_private.learning_completion_evidence,app_private.learning_receipt_outbox from public,anon,authenticated,service_role;

-- Private command evidence contains identifiers only, never learner profile data.
create table app_private.learning_receipt_command_audit (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null,
  authentication_method text not null check(authentication_method in ('jwt_aal2','app_sms')),
  action text not null check(action in ('provision','revoke','acknowledge','retract')),
  object_id uuid not null, created_at timestamptz not null default now()
);
create index learning_receipt_command_audit_actor on app_private.learning_receipt_command_audit(actor_id);
alter table app_private.learning_receipt_command_audit enable row level security;
revoke all on app_private.learning_receipt_command_audit from public,anon,authenticated,service_role;

create function public.resolve_learning_receipt_identity(p_actor_id uuid,p_organization_id uuid,p_employee_id uuid,p_authentication_method text default 'jwt_aal2') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform app_private.require_learning_bridge_actor(p_actor_id,p_authentication_method);
  select jsonb_build_object('organizationId',o.id,'employeeId',e.id,'profileId',p.id) into result
    from public.organizations o join public.employees e on e.organization_id=o.id
    join public.facilities f on f.id=e.facility_id and f.organization_id=o.id
    join public.profiles p on p.id=e.profile_id join auth.users u on u.id=p.id
    where o.id=p_organization_id and e.id=p_employee_id and e.status='active' and p.is_active
      and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now());
  if result is null then raise exception 'Active native organization, employee and linked account required.' using errcode='22023'; end if;
  return result;
end;
$$;

-- Called only by the server after Hub command authorization and native actor checks.
create function public.provision_learning_receipt_mapping(p_actor_id uuid,p_mapping_id uuid,p_organization_id uuid,p_employee_id uuid,
  p_hub_tenant_id uuid,p_hub_user_id uuid,p_course_id uuid,p_version_id uuid,p_source_revision text,p_authentication_method text default 'jwt_aal2') returns jsonb
language plpgsql security definer set search_path='' as $$
declare source_payload text; actual_hash text; prior app_private.learning_receipt_mappings%rowtype; identity jsonb;
begin
  perform app_private.require_learning_bridge_actor(p_actor_id,p_authentication_method);
  identity:=public.resolve_learning_receipt_identity(p_actor_id,p_organization_id,p_employee_id,p_authentication_method);
  if p_mapping_id is null or p_hub_tenant_id is null or p_hub_user_id is null or not exists(
    select 1 from public.employees e join public.facilities f on f.id=e.facility_id
    where e.id=p_employee_id and e.organization_id=p_organization_id and f.organization_id=p_organization_id and e.status='active') then
    raise exception 'Explicit active learner and tenant mapping required.' using errcode='22023';
  end if;
  select * into prior from app_private.learning_receipt_mappings where id=p_mapping_id for update;
  if found then
    if prior.active and prior.organization_id=p_organization_id and prior.employee_id=p_employee_id
      and prior.native_profile_id=(identity->>'profileId')::uuid
      and prior.hub_tenant_id=p_hub_tenant_id and prior.hub_user_id=p_hub_user_id
      and prior.course_id=p_course_id and prior.version_id=p_version_id and prior.source_revision=p_source_revision then
      return jsonb_build_object('mappingId',prior.id,'sourceRevision',prior.source_revision,'active',true);
    end if;
    raise exception 'A mapping cannot be repointed or reactivated.' using errcode='40001';
  end if;
  perform 1 from public.courses c where c.id=p_course_id and c.organization_id is null
    and c.status='published' and c.current_version_id=p_version_id for share;
  if not found then raise exception 'Bind only a current published global course version.' using errcode='22023'; end if;
  source_payload:=app_private.learning_source_payload(p_course_id,p_version_id);
  actual_hash:=encode(extensions.digest(source_payload,'sha256'),'hex');
  if actual_hash is null or actual_hash is distinct from p_source_revision then
    raise exception 'Source policy changed. Preserve and review its exact revision before binding.' using errcode='40001';
  end if;
  insert into app_private.learning_source_policies(revision,course_id,version_id,payload)
    values(actual_hash,p_course_id,p_version_id,source_payload) on conflict(revision) do nothing;
  insert into app_private.learning_receipt_mappings(id,organization_id,employee_id,native_profile_id,hub_tenant_id,hub_user_id,course_id,version_id,source_revision,created_by)
    values(p_mapping_id,p_organization_id,p_employee_id,(identity->>'profileId')::uuid,p_hub_tenant_id,p_hub_user_id,p_course_id,p_version_id,actual_hash,p_actor_id);
  insert into app_private.learning_receipt_command_audit(actor_id,authentication_method,action,object_id) values(p_actor_id,p_authentication_method,'provision',p_mapping_id);
  return jsonb_build_object('mappingId',p_mapping_id,'sourceRevision',actual_hash,'active',true);
end;
$$;

create function public.revoke_learning_receipt_mapping(p_actor_id uuid,p_mapping_id uuid,p_authentication_method text default 'jwt_aal2') returns void
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.require_learning_bridge_actor(p_actor_id,p_authentication_method);
  update app_private.learning_receipt_mappings set active=false,revoked_at=coalesce(revoked_at,now()) where id=p_mapping_id;
  if not found then raise exception 'Mapping unavailable.' using errcode='22023'; end if;
  insert into app_private.learning_receipt_command_audit(actor_id,authentication_method,action,object_id) values(p_actor_id,p_authentication_method,'revoke',p_mapping_id);
  update app_private.learning_receipt_outbox o set state='quarantined',quarantine_reason='mapping_disabled'
    where o.state='pending' and o.kind='completed' and exists(select 1 from app_private.learning_assignment_bindings b
      where b.assignment_id=o.assignment_id and b.mapping_id=p_mapping_id);
end;
$$;

create function app_private.bind_prospective_learning_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare mapping app_private.learning_receipt_mappings%rowtype; source_payload text; source_hash text;
begin
  select * into mapping from app_private.learning_receipt_mappings m where m.active
    and m.employee_id=new.employee_id and m.organization_id=new.organization_id
    and m.course_id=new.course_id and m.version_id=new.course_version_id and new.assigned_at>=m.created_at for share;
  if not found then return new; end if;
  source_payload:=app_private.learning_source_payload(new.course_id,new.course_version_id);
  source_hash:=encode(extensions.digest(source_payload,'sha256'),'hex');
  if source_hash is null then return new; end if;
  insert into app_private.learning_source_policies(revision,course_id,version_id,payload)
    values(source_hash,new.course_id,new.course_version_id,source_payload) on conflict(revision) do nothing;
  insert into app_private.learning_assignment_bindings(assignment_id,mapping_id,assignment_revision)
    values(new.id,mapping.id,source_hash);
  return new;
end;
$$;
create trigger bind_prospective_learning_assignment after insert on public.course_assignments
for each row execute function app_private.bind_prospective_learning_assignment();

create function app_private.capture_prospective_learning_completion() returns trigger
language plpgsql security definer set search_path='' as $$
declare binding app_private.learning_assignment_bindings%rowtype; mapping app_private.learning_receipt_mappings%rowtype;
  assignment public.course_assignments%rowtype; certificate public.certificates%rowtype;
  source_payload text; source_hash text; evidence jsonb; receipt jsonb; receipt_text text; evidence_hash text;
  credit_rows jsonb; attestation_rows jsonb; exam_score numeric; renewal_rows jsonb; quiz_rows jsonb;
  provider_snapshot jsonb; reason text; event_id uuid:=gen_random_uuid();
begin
  select * into binding from app_private.learning_assignment_bindings where assignment_id=new.course_assignment_id for update;
  if not found then return new; end if; -- Historical/unbound evidence never enters the bridge.
  if exists(select 1 from app_private.learning_completion_evidence where assignment_id=binding.assignment_id) then return new; end if;
  select * into mapping from app_private.learning_receipt_mappings where id=binding.mapping_id for share;
  select * into assignment from public.course_assignments where id=binding.assignment_id for share;
  select * into certificate from public.certificates where id=new.id;
  if assignment.status<>'completed' or assignment.completion_recorded_at is null or certificate.id is null then return new; end if;
  source_payload:=app_private.learning_source_payload(assignment.course_id,assignment.course_version_id);
  source_hash:=encode(extensions.digest(source_payload,'sha256'),'hex');
  if source_hash is null then raise exception 'Bound source policy unavailable.' using errcode='55000'; end if;
  insert into app_private.learning_source_policies(revision,course_id,version_id,payload)
    values(source_hash,assignment.course_id,assignment.course_version_id,source_payload) on conflict(revision) do nothing;

  select coalesce(jsonb_agg(jsonb_build_object('id',cc.id,'trainingTypeId',cc.training_type_id,'topicCode',cc.topic_code,
    'hours',cc.credit_hours::text,'year',cc.training_year,'creditedAt',cc.credited_at,'citation',cc.citation_note) order by cc.id),'[]'::jsonb)
    into credit_rows from public.course_completion_credits cc where cc.course_assignment_id=assignment.id;
  select coalesce(jsonb_agg(jsonb_build_object('blockId',a.course_block_id,'version',a.attestation_version,
    'statementSha256',encode(extensions.digest(a.attestation_text,'sha256'),'hex'),'attestedAt',a.attested_at) order by a.course_block_id),'[]'::jsonb)
    into attestation_rows from public.course_learner_attestations a where a.course_assignment_id=assignment.id;
  select max(qa.score_percent) filter(where q.quiz_kind='final_exam' and qa.passed),
    coalesce(jsonb_agg(jsonb_build_object('attemptId',qa.id,'quizId',q.id,'kind',q.quiz_kind,'score',qa.score_percent,
      'passed',qa.passed,'threshold',qa.passing_score_percent_at_attempt) order by qa.id),'[]'::jsonb)
    into exam_score,quiz_rows from public.quiz_attempts qa join public.quizzes q on q.id=qa.quiz_id
    join public.course_blocks b on b.id=q.course_block_id where qa.assignment_id=assignment.id
    and b.course_version_id=assignment.course_version_id and qa.submitted_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'trainingTypeId',r.training_type_id,'completionDate',r.completion_date,
    'status',r.status,'score',r.score,'hours',r.hours::text) order by r.id),'[]'::jsonb) into renewal_rows
    from public.employee_training_records r join public.courses c on c.id=assignment.course_id
    where r.employee_id=assignment.employee_id and r.training_type_id=c.renewal_training_type_id
      and r.certificate_number=certificate.credential_number;
  provider_snapshot:=jsonb_build_object('name',certificate.training_provider,'credential',certificate.provider_credential,'at',certificate.provider_snapshot_at);
  evidence:=jsonb_build_object('assignmentId',assignment.id,'courseId',assignment.course_id,'versionId',assignment.course_version_id,
    'completedAt',assignment.completion_recorded_at,'certificate',jsonb_build_object('id',certificate.id,'issuedAt',certificate.issued_at,
      'expiresAt',certificate.expires_at,'provider',provider_snapshot),'credits',credit_rows,'attestations',attestation_rows,
    'quizAttempts',quiz_rows,'renewalRecords',renewal_rows,'assignmentRevision',binding.assignment_revision,'completionRevision',source_hash);
  evidence_hash:=encode(extensions.digest(evidence::text,'sha256'),'hex');
  insert into app_private.learning_completion_evidence(assignment_id,completion_revision,evidence,evidence_sha256)
    values(assignment.id,source_hash,evidence,evidence_hash);
  reason:=case when mapping.organization_id<>assignment.organization_id or mapping.employee_id<>assignment.employee_id
      or mapping.course_id<>assignment.course_id or mapping.version_id<>assignment.course_version_id
      or not exists(select 1 from public.employees e join public.profiles p on p.id=e.profile_id join auth.users u on u.id=p.id
        where e.id=mapping.employee_id and e.profile_id=mapping.native_profile_id and e.status='active' and p.is_active
          and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then 'binding_identity_drift'
    when not mapping.active then 'mapping_disabled'
    when mapping.source_revision<>binding.assignment_revision or binding.assignment_revision<>source_hash then 'policy_drift'
    when (source_payload::jsonb->'course'->>'renewalTrainingTypeId') is not null and jsonb_array_length(renewal_rows)=0 then 'missing_renewal_evidence' end;
  receipt:=jsonb_build_object('contract','caremetric.learning-receipt.v1','eventId',event_id,'kind','completed','sequence',1,
    'mappingId',mapping.id,'source','carebase','assignmentId',assignment.id,'sourceCourseId',assignment.course_id,
    'sourceVersionId',assignment.course_version_id,'mappingRevision',mapping.source_revision,'assignmentRevision',binding.assignment_revision,
    'completionRevision',source_hash,'hubTenantId',mapping.hub_tenant_id,'hubUserId',mapping.hub_user_id,
    'completedAt',assignment.completion_recorded_at,'evidenceSha256',evidence_hash,'finalExamScore',exam_score,
    'certificate',jsonb_build_object('id',certificate.id,'issuedAt',certificate.issued_at,'expiresAt',certificate.expires_at,
      'providerEvidenceSha256',encode(extensions.digest(provider_snapshot::text,'sha256'),'hex')),
    'credits',(select coalesce(jsonb_agg(value-'citation'),'[]'::jsonb) from jsonb_array_elements(credit_rows)),
    'attestations',attestation_rows,'quizEvidenceSha256',encode(extensions.digest(quiz_rows::text,'sha256'),'hex'),
    'renewalEvidenceSha256',encode(extensions.digest(renewal_rows::text,'sha256'),'hex'));
  receipt_text:=receipt::text;
  insert into app_private.learning_receipt_outbox(id,assignment_id,sequence,kind,payload,payload_sha256,state,quarantine_reason)
    values(event_id,assignment.id,1,'completed',receipt_text,encode(extensions.digest(receipt_text,'sha256'),'hex'),
      case when reason is null then 'pending' else 'quarantined' end,reason);
  return new;
end;
$$;
-- Deferred capture sees credits, provider snapshots and renewal writes completed
-- by the SAME native transaction. No network call occurs here. A local ledger
-- insertion failure intentionally rolls back that bound completion atomically;
-- remote Hub outages cannot affect native completion and leave outbox work intact.
create constraint trigger capture_prospective_learning_completion after insert on public.certificates
deferrable initially deferred for each row execute function app_private.capture_prospective_learning_completion();

create function public.list_learning_receipt_outbox(p_actor_id uuid,p_limit integer default 20,p_authentication_method text default 'jwt_aal2') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform app_private.require_learning_bridge_actor(p_actor_id,p_authentication_method);
  if p_limit is null or p_limit not between 1 and 25 then raise exception 'Invalid receipt limit.' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('eventId',s.id,'payload',s.payload,'sourceDigest',s.payload_sha256,
    'state',s.state,'reason',s.quarantine_reason) order by s.assignment_id,s.sequence) from
    (select o.* from app_private.learning_receipt_outbox o where o.state<>'delivered' and o.quarantine_reason is distinct from 'receipt_retracted'
      order by (o.state='pending') desc,o.created_at,o.assignment_id,o.sequence limit p_limit) s),'[]'::jsonb);
end;
$$;

create function public.acknowledge_learning_receipt(p_actor_id uuid,p_event_id uuid,p_source_digest text,p_authentication_method text default 'jwt_aal2') returns void
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.require_learning_bridge_actor(p_actor_id,p_authentication_method);
  update app_private.learning_receipt_outbox o set state='delivered',delivered_at=coalesce(delivered_at,now())
    where o.id=p_event_id and o.payload_sha256=p_source_digest and o.state in ('pending','delivered')
      and exists(select 1 from app_private.learning_assignment_bindings b join app_private.learning_receipt_mappings m on m.id=b.mapping_id
        where b.assignment_id=o.assignment_id and (m.active or o.kind='retracted'));
  if not found then raise exception 'Receipt cannot be acknowledged.' using errcode='40001'; end if;
  insert into app_private.learning_receipt_command_audit(actor_id,authentication_method,action,object_id) values(p_actor_id,p_authentication_method,'acknowledge',p_event_id);
end;
$$;

-- Retraction withdraws only central reporting evidence. It does not delete a
-- native certificate, undo earned hours, or invent an unsupported native recall.
create function public.retract_learning_receipt(p_actor_id uuid,p_assignment_id uuid,p_expected_sequence integer,p_authentication_method text default 'jwt_aal2') returns uuid
language plpgsql security definer set search_path='' as $$
declare prior app_private.learning_receipt_outbox%rowtype; event_id uuid:=gen_random_uuid(); payload jsonb; serialized text;
begin
  perform app_private.require_learning_bridge_actor(p_actor_id,p_authentication_method);
  perform 1 from app_private.learning_completion_evidence where assignment_id=p_assignment_id for update;
  if not found then raise exception 'Bound completion unavailable.' using errcode='22023'; end if;
  select * into prior from app_private.learning_receipt_outbox where assignment_id=p_assignment_id order by sequence desc limit 1;
  if prior.kind='retracted' then return prior.id; end if;
  if prior.sequence is distinct from p_expected_sequence then raise exception 'Receipt revision changed.' using errcode='40001'; end if;
  payload:=(prior.payload::jsonb)||jsonb_build_object('eventId',event_id,'kind','retracted','sequence',prior.sequence+1);
  serialized:=payload::text;
  update app_private.learning_receipt_outbox set state='quarantined',quarantine_reason='receipt_retracted'
    where id=prior.id and state<>'delivered';
  insert into app_private.learning_receipt_outbox(id,assignment_id,sequence,kind,payload,payload_sha256,state)
    values(event_id,p_assignment_id,prior.sequence+1,'retracted',serialized,encode(extensions.digest(serialized,'sha256'),'hex'),
      case when prior.quarantine_reason in ('policy_drift','binding_identity_drift') then 'quarantined' else 'pending' end);
  update app_private.learning_receipt_outbox set quarantine_reason=prior.quarantine_reason where id=event_id and state='quarantined';
  insert into app_private.learning_receipt_command_audit(actor_id,authentication_method,action,object_id) values(p_actor_id,p_authentication_method,'retract',event_id);
  return event_id;
end;
$$;
revoke all on function app_private.learning_source_payload(uuid,uuid),app_private.require_learning_bridge_actor(uuid,text),
  app_private.bind_prospective_learning_assignment(),app_private.capture_prospective_learning_completion() from public,anon,authenticated,service_role;
revoke all on function public.provision_learning_receipt_mapping(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text),
  public.resolve_learning_receipt_identity(uuid,uuid,uuid,text),
  public.revoke_learning_receipt_mapping(uuid,uuid,text),public.list_learning_receipt_outbox(uuid,integer,text),
  public.acknowledge_learning_receipt(uuid,uuid,text,text),public.retract_learning_receipt(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.provision_learning_receipt_mapping(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text),
  public.resolve_learning_receipt_identity(uuid,uuid,uuid,text),
  public.revoke_learning_receipt_mapping(uuid,uuid,text),public.list_learning_receipt_outbox(uuid,integer,text),
  public.acknowledge_learning_receipt(uuid,uuid,text,text),public.retract_learning_receipt(uuid,uuid,integer,text) to service_role;
