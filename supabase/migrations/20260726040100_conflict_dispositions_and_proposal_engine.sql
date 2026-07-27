-- Conflict dispositions and a proposal engine that actually evaluates its rules (Phase 3a/3b).
--
-- TWO PROBLEMS THIS FIXES.
--
-- 1. `generate_support_plan_proposal` (20260714100000) selects EVERY active mapping rule and
--    aggregates their proposed needs/services/interventions, without ever comparing a rule's
--    `condition` against the assessment. With no rules seeded that was invisible; the moment rules
--    exist it would propose every intervention in the pack for every resident. The engine had the
--    right shape and no evaluation step. This adds one.
--
-- 2. Conflicts were an untyped `text[]`. Conflicts themselves stay DERIVED (see
--    residentCareConflicts.ts) so they re-compute from current records rather than going stale --
--    what needs persisting is the human's disposition, which is what this table stores.

-- ---------------------------------------------------------------------------
-- Conflict dispositions
-- ---------------------------------------------------------------------------

create table public.resident_care_conflict_dispositions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  -- Derived from the exact disagreement (see residentCareConflicts.ts). If the underlying values
  -- change the key changes and the conflict resurfaces, which is the behaviour we want: resolving
  -- "two-person vs supervision" must not silently absolve "mechanical lift vs supervision" later.
  conflict_key text not null check (length(btrim(conflict_key)) between 3 and 400),
  conflict_kind text not null check (conflict_kind in (
    'transfer_assistance_mismatch',
    'diet_texture_mismatch',
    'documented_assistance_exceeds_plan',
    'fall_risk_without_intervention',
    'plan_predates_hospital_return'
  )),
  disposition text not null check (disposition in ('accepted', 'corrected', 'exception_documented')),
  -- Every disposition needs a reason. "Accepted" without a note is indistinguishable from someone
  -- clearing a warning to make it go away, which is exactly what a surveyor probes for.
  note text not null check (length(btrim(note)) >= 5),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (resident_id, conflict_key)
);

create index resident_care_conflict_dispositions_resident_idx
  on public.resident_care_conflict_dispositions(resident_id, resolved_at desc);
create index resident_care_conflict_dispositions_scope_idx
  on public.resident_care_conflict_dispositions(organization_id, facility_id, conflict_kind);

alter table public.resident_care_conflict_dispositions enable row level security;
revoke all on table public.resident_care_conflict_dispositions from public, anon, authenticated, service_role;
grant all on table public.resident_care_conflict_dispositions to service_role;
grant select on table public.resident_care_conflict_dispositions to authenticated;

create policy resident_care_conflict_dispositions_select on public.resident_care_conflict_dispositions
  for select to authenticated
  using (app_private.admission_row_visible(organization_id, facility_id));

create trigger audit_resident_care_conflict_dispositions
  after insert or update or delete on public.resident_care_conflict_dispositions
  for each row execute function public.audit_log_trigger();

create or replace function public.record_care_conflict_disposition(
  p_resident_id uuid,
  p_conflict_key text,
  p_conflict_kind text,
  p_disposition text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_resident public.residents%rowtype; v_id uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v_resident.organization_id, v_resident.facility_id);

  if length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'A disposition requires a note explaining it' using errcode = '22023';
  end if;

  insert into public.resident_care_conflict_dispositions(
    organization_id, facility_id, resident_id, conflict_key, conflict_kind, disposition, note, resolved_by
  )
  values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    btrim(p_conflict_key), p_conflict_kind, p_disposition, btrim(p_note), auth.uid()
  )
  -- Re-dispositioning the same disagreement replaces the prior decision; the audit trigger keeps
  -- the old one.
  on conflict (resident_id, conflict_key) do update set
    disposition = excluded.disposition,
    note = excluded.note,
    resolved_by = excluded.resolved_by,
    resolved_at = now()
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.record_care_conflict_disposition(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_care_conflict_disposition(uuid, text, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rule condition evaluation
-- ---------------------------------------------------------------------------
--
-- `support_plan_assessment_mapping_rules.condition` is a jsonb predicate evaluated against one
-- answer. Supported forms, deliberately small -- a rule language nobody can read is a rule language
-- nobody can review:
--
--   {"equals": ["two_person","mechanical_lift"]}   answer is one of these
--   {"notEquals": ["independent"]}                  answer is none of these
--   {"gte": 2} / {"lte": 5}                         numeric comparison
--   {"isTrue": true} / {"isTrue": false}            boolean answer
--   {}                                              matches whenever the field is answered at all
--
-- An unanswered field NEVER matches. A rule must fire on evidence, not on absence.

create or replace function app_private.mapping_rule_condition_matches(
  p_condition jsonb,
  p_answer jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_number numeric;
begin
  if p_answer is null or jsonb_typeof(p_answer) = 'null' then return false; end if;
  if p_condition is null or jsonb_typeof(p_condition) <> 'object' then return false; end if;

  if p_condition ? 'isTrue' then
    return jsonb_typeof(p_answer) = 'boolean'
      and (p_answer = 'true'::jsonb) = ((p_condition->>'isTrue') = 'true');
  end if;

  if p_condition ? 'gte' or p_condition ? 'lte' then
    if jsonb_typeof(p_answer) <> 'number' then return false; end if;
    v_number := (p_answer #>> '{}')::numeric;
    if p_condition ? 'gte' and v_number < (p_condition->>'gte')::numeric then return false; end if;
    if p_condition ? 'lte' and v_number > (p_condition->>'lte')::numeric then return false; end if;
    return true;
  end if;

  v_text := p_answer #>> '{}';
  if v_text is null or btrim(v_text) = '' then return false; end if;

  if p_condition ? 'equals' then
    return exists (
      select 1 from jsonb_array_elements_text(p_condition->'equals') as candidate
      where candidate = v_text
    );
  end if;

  if p_condition ? 'notEquals' then
    return not exists (
      select 1 from jsonb_array_elements_text(p_condition->'notEquals') as candidate
      where candidate = v_text
    );
  end if;

  -- Empty condition: the field being answered at all is the trigger.
  return true;
end $$;

revoke all on function app_private.mapping_rule_condition_matches(jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Proposal generation from a finalized review
-- ---------------------------------------------------------------------------

create or replace function public.generate_support_plan_proposal_from_review(
  p_review_id uuid,
  p_reason text default 'Assessment review indicates the support plan may need revision'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.resident_assessment_reviews%rowtype;
  v_res public.residents%rowtype;
  v_current uuid;
  v_id uuid;
  v_work uuid;
  v_matched jsonb := '[]'::jsonb;
  v_rule record;
begin
  select * into v_review from public.resident_assessment_reviews where id = p_review_id;
  if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
  select * into v_res from public.residents where id = v_review.resident_id;
  perform app_private.assert_resident_care_manager(v_res.organization_id, v_res.facility_id);
  if v_review.status <> 'final' then
    raise exception 'Only a finalized review can generate a support-plan proposal' using errcode = '22023';
  end if;

  select id into v_current from public.resident_support_plans
    where resident_id = v_res.id and state = 'active'
    order by effective_date desc limit 1;

  -- Evaluate each active rule against the answer at its assessment_item_key. This is the step the
  -- previous engine was missing: only rules whose condition MATCHES the resident's actual answer
  -- contribute, and each contribution carries the rule that produced it so the administrator can
  -- see why it was suggested.
  for v_rule in
    select r.*
    from public.support_plan_assessment_mapping_rules r
    where r.is_active
      and (r.organization_id is null or r.organization_id = v_res.organization_id)
      and (r.facility_id is null or r.facility_id = v_res.facility_id)
      and current_date between r.effective_from and coalesce(r.effective_to, current_date)
    order by r.rule_key, r.version desc
  loop
    if app_private.mapping_rule_condition_matches(
      v_rule.condition,
      v_review.answers -> v_rule.assessment_item_key
    ) then
      v_matched := v_matched || jsonb_build_array(jsonb_build_object(
        'ruleKey', v_rule.rule_key,
        'ruleVersion', v_rule.version,
        'assessmentItemKey', v_rule.assessment_item_key,
        'answer', v_review.answers -> v_rule.assessment_item_key,
        'rationale', v_rule.rationale,
        'need', v_rule.proposed_need,
        'service', v_rule.proposed_service,
        'intervention', v_rule.proposed_intervention,
        'dme', v_rule.proposed_dme
      ));
    end if;
  end loop;

  insert into public.support_plan_proposals(
    organization_id, facility_id, resident_id, assessment_form_id, current_plan_id,
    proposal, conflict_warnings, rationale, owner_profile_id, due_at
  )
  values (
    v_res.organization_id, v_res.facility_id, v_res.id, null, v_current,
    jsonb_build_object(
      'source', 'assessment_review',
      'reviewId', v_review.id,
      'templateKey', v_review.template_key,
      'templateVersion', v_review.template_version,
      'items', v_matched
    ),
    case when v_current is null then array['No support plan is currently in force.']::text[] else array[]::text[] end,
    btrim(coalesce(p_reason, '')), auth.uid(), now() + interval '3 days'
  )
  on conflict (organization_id, assessment_form_id, resident_id) do update set
    proposal = excluded.proposal,
    conflict_warnings = excluded.conflict_warnings,
    rationale = excluded.rationale,
    updated_at = now()
  returning id into v_id;

  insert into public.work_items(
    organization_id, facility_id, source_type, source_id, deduplication_key, title, description,
    owner_profile_id, priority, due_at, state, created_by
  )
  values (
    v_res.organization_id, v_res.facility_id, 'rule_exception', v_id, 'support-plan-proposal:' || v_id,
    'Review support-plan proposal',
    'An assessment review produced proposed changes to the support plan.',
    auth.uid(), 'high', now() + interval '3 days', 'open', auth.uid()
  )
  on conflict (organization_id, deduplication_key) do update set updated_at = now()
  returning id into v_work;
  update public.support_plan_proposals set work_item_id = v_work where id = v_id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v_res.organization_id, auth.uid(), 'support_plan_proposal', v_id::text, 'support_plan.proposal_generated',
    jsonb_build_object('reviewId', v_review.id, 'matchedRules', jsonb_array_length(v_matched), 'workItemId', v_work));

  return v_id;
end $$;

revoke all on function public.generate_support_plan_proposal_from_review(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.generate_support_plan_proposal_from_review(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seeded PA rule pack (platform-scoped: organization_id and facility_id null)
-- ---------------------------------------------------------------------------
--
-- These are the rules behind the worked example in the request: a resident who requires extensive
-- toileting assistance, has had two recent falls, uses a walker, and frequently forgets to request
-- assistance should be proposed scheduled toileting, standby assistance during ambulation, a walker
-- within reach, fall-prevention checks, cueing to call for help, and refusal monitoring.
--
-- Every rule is ADVISORY. It produces a proposal an administrator approves, modifies, or rejects
-- per item; nothing here writes to a support plan directly. `rationale` is shown next to the
-- suggestion so "why was this suggested" is answered in the UI rather than in the code.
--
-- assessment_item_key values are the stable template field keys from assessmentTemplates.ts.

insert into public.support_plan_assessment_mapping_rules
  (organization_id, facility_id, rule_key, version, assessment_item_key, condition,
   proposed_need, proposed_service, proposed_intervention, proposed_dme, rationale)
values
  (null, null, 'pa.toileting.scheduled', 1, 'scheduled_toileting', '{"isTrue": false}'::jsonb,
   '{"key": "toileting_support", "need": "Requires assistance with toileting"}'::jsonb,
   '{"key": "scheduled_toileting", "service_code": "toileting_schedule", "service_name": "Scheduled toileting every two hours", "frequency": "hourly", "frequency_detail": "Every 2 hours while awake", "documentation_mode": "every_task"}'::jsonb,
   '{"key": "scheduled_toileting", "intervention": "Offer toileting on a two-hourly schedule rather than on request"}'::jsonb,
   '{}'::jsonb,
   'The continence review recorded no scheduled toileting in place. Proactive scheduling is what reduces both incontinence episodes and the unassisted transfers that cause falls.'),

  (null, null, 'pa.toileting.cue_for_help', 1, 'requests_assistance_reliably', '{"isTrue": false}'::jsonb,
   '{"key": "call_for_help", "need": "Does not reliably request assistance"}'::jsonb,
   '{"key": "cue_call_for_help", "service_code": "cue_call_bell", "service_name": "Cue resident to call for help", "frequency": "daily", "documentation_mode": "exception_only"}'::jsonb,
   '{"key": "cue_call_for_help", "intervention": "Cue the resident to use the call bell at each contact; do not rely on them initiating"}'::jsonb,
   '{}'::jsonb,
   'The continence review recorded that the resident does not reliably request assistance. Availability alone does not help someone who does not ask; the cue has to be built into the plan.'),

  (null, null, 'pa.mobility.standby_ambulation', 1, 'transfer_assistance', '{"equals": ["supervision", "one_person"]}'::jsonb,
   '{"key": "ambulation_support", "need": "Requires standby assistance when ambulating"}'::jsonb,
   '{"key": "standby_ambulation", "service_code": "standby_assist", "service_name": "Standby assistance during ambulation", "frequency": "daily", "documentation_mode": "exception_only"}'::jsonb,
   '{"key": "standby_ambulation", "intervention": "Remain within arm''s reach while the resident is walking"}'::jsonb,
   '{}'::jsonb,
   'The mobility review recorded that the resident needs supervision or hands-on help to transfer, which is the same instability that makes unaccompanied walking a fall risk.'),

  (null, null, 'pa.mobility.device_within_reach', 1, 'ambulation_status', '{"equals": ["cane", "walker", "rollator"]}'::jsonb,
   '{"key": "assistive_device", "need": "Uses a walking aid"}'::jsonb,
   '{"key": "device_within_reach", "service_code": "device_placement", "service_name": "Walking aid placed within reach", "frequency": "daily", "documentation_mode": "exception_only"}'::jsonb,
   '{"key": "device_within_reach", "intervention": "Position the walking aid within reach before leaving the resident"}'::jsonb,
   '{"key": "walking_aid", "item": "Resident''s walking aid"}'::jsonb,
   'The mobility review recorded a walking aid. An aid the resident cannot reach is the same as no aid, and is a routine finding after an unwitnessed fall.'),

  (null, null, 'pa.falls.prevention_checks', 1, 'falls_last_90_days', '{"gte": 2}'::jsonb,
   '{"key": "fall_prevention", "need": "Repeat falls in the last 90 days"}'::jsonb,
   '{"key": "fall_prevention_checks", "service_code": "fall_checks", "service_name": "Fall-prevention safety checks", "frequency": "hourly", "frequency_detail": "Each round", "documentation_mode": "every_task"}'::jsonb,
   '{"key": "fall_prevention_checks", "intervention": "Check footwear, lighting, call bell, and clear path at each round"}'::jsonb,
   '{}'::jsonb,
   'Two or more falls in 90 days is a pattern, not an accident. Repeat falls indicate the current fall-prevention interventions are not working.'),

  (null, null, 'pa.falls.high_risk_checks', 1, 'fall_risk', '{"equals": ["high"]}'::jsonb,
   '{"key": "fall_prevention", "need": "Assessed high fall risk"}'::jsonb,
   '{"key": "fall_prevention_checks", "service_code": "fall_checks", "service_name": "Fall-prevention safety checks", "frequency": "hourly", "documentation_mode": "every_task"}'::jsonb,
   '{"key": "fall_prevention_checks", "intervention": "Check footwear, lighting, call bell, and clear path at each round"}'::jsonb,
   '{}'::jsonb,
   'A documented high fall risk with no fall intervention in the plan is the most common support-plan gap at survey.'),

  (null, null, 'pa.services.monitor_refusals', 1, 'requests_assistance_reliably', '{"isTrue": false}'::jsonb,
   '{"key": "refusal_monitoring", "need": "Service refusals need to be visible"}'::jsonb,
   '{"key": "monitor_refusals", "service_code": "refusal_monitoring", "service_name": "Monitor and document refusals", "frequency": "daily", "documentation_mode": "exception_only"}'::jsonb,
   '{"key": "monitor_refusals", "intervention": "Record every refusal with what was offered and what was done next"}'::jsonb,
   '{}'::jsonb,
   'Refusals are the earliest signal that a plan no longer fits the resident, and they only become evidence if they are documented at the time.'),

  (null, null, 'pa.nutrition.texture_modified', 1, 'diet_texture', '{"notEquals": ["regular"]}'::jsonb,
   '{"key": "modified_texture", "need": "Requires a modified-texture diet"}'::jsonb,
   '{"key": "texture_modified_meals", "service_code": "modified_texture", "service_name": "Serve modified-texture meals", "frequency": "daily", "documentation_mode": "every_task"}'::jsonb,
   '{"key": "texture_modified_meals", "intervention": "Confirm the tray matches the ordered texture before serving"}'::jsonb,
   '{}'::jsonb,
   'A texture order that never reaches the tray is a choking risk, and the check belongs in the plan rather than in someone''s memory.'),

  (null, null, 'pa.behaviour.increased_supervision', 1, 'supervision_level_indicated', '{"equals": ["increased", "continuous"]}'::jsonb,
   '{"key": "behavioural_supervision", "need": "Requires increased supervision"}'::jsonb,
   '{"key": "increased_supervision", "service_code": "supervision", "service_name": "Increased supervision checks", "frequency": "hourly", "documentation_mode": "every_task"}'::jsonb,
   '{"key": "increased_supervision", "intervention": "Increase check frequency and record what was observed each time"}'::jsonb,
   '{}'::jsonb,
   'The cognitive and behavioral review indicated supervision above the routine level. Staffing for it is a scheduling decision that depends on the plan saying so.'),

  (null, null, 'pa.elopement.monitoring', 1, 'elopement_risk', '{"equals": ["monitored", "high"]}'::jsonb,
   '{"key": "elopement_risk", "need": "Elopement risk requires monitoring"}'::jsonb,
   '{"key": "elopement_checks", "service_code": "elopement_monitoring", "service_name": "Whereabouts checks", "frequency": "hourly", "documentation_mode": "every_task"}'::jsonb,
   '{"key": "elopement_checks", "intervention": "Confirm and record the resident''s location at each round"}'::jsonb,
   '{}'::jsonb,
   'A recorded elopement risk obliges the facility to know where the resident is; the check has to be a scheduled task, not a habit.')
on conflict (organization_id, facility_id, rule_key, version) do nothing;
