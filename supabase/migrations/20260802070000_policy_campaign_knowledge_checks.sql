-- Policy campaign knowledge checks (BACKLOG.md E4, MVP slice).
--
-- WHAT E4 ACTUALLY NEEDED. The E4 row reads "Policy campaign center (version pin, targets,
-- knowledge check)", but two of those three already shipped in 20260705151703_policy_attestation_core
-- and were reachable from PolicyDocumentDetail.tsx:
--   * version pin -- policy_attestation_campaigns.policy_document_version_id is NOT NULL, published
--     versions are frozen by lock_published_policy_version(), and every attestation stores the
--     content_hash it was signed against.
--   * targets -- campaigns fan out to explicitly picked employees at assign time, the same shape
--     useApplyTrainingPlanToEmployee uses for training plans (the core migration says so in its own
--     header, and deliberately gave campaigns no facility_id).
-- The knowledge check was the missing third: nothing in the repo referenced one. That is all this
-- migration adds -- it does not rebuild the campaign machinery that already exists.
--
-- WHY THE CORRECT ANSWER NEVER LEAVES THE SERVER. An attestation is a compliance record that the
-- signer understood the policy, so a knowledge check whose answer key ships to the browser is worth
-- nothing -- anyone can read it out of the network tab. policy_campaign_questions is therefore
-- readable only by the administrators who author it; the employee taking the check reads questions
-- through get_policy_knowledge_check() (which omits correct_choice_index entirely) and submits
-- through submit_policy_knowledge_check() (which grades server-side). The key is not a filtered
-- column or a nullable field -- it is absent from every shape an employee can reach, and redacted
-- out of the audit log besides (section 6).
--
-- It is NOT, however, unknowable. Reporting a score at all leaks it slowly: a learner can submit a
-- baseline, change one choice, and read the delta. Returning the score is a deliberate product
-- choice (someone who fails should know how close they were), so the leak is bounded rather than
-- closed -- see the attempt cap in submit_policy_knowledge_check(). Claiming otherwise in this
-- header would be the more dangerous error, because the next person would build on it.
--
-- WHY QUESTIONS FREEZE ONCE SOMEONE HAS PASSED. Same reasoning as lock_published_policy_version:
-- if the questions can change after an attestation is on record, that record no longer describes
-- what the signer was actually asked. Editing is allowed only while no attempt has ever passed.

-- ---------------------------------------------------------------------------
-- 1. Questions (authored per campaign; the answer key lives here and only here)
-- ---------------------------------------------------------------------------

-- A CHECK constraint cannot contain a subquery, and validating "every element is a non-empty
-- string" inherently needs to walk the array. An IMMUTABLE function is the supported way to put
-- that kind of predicate in a constraint.
create or replace function public.policy_choices_are_valid(p_choices jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_choices) = 'array'
     and jsonb_array_length(p_choices) between 2 and 6
     and not exists (
       select 1
       from jsonb_array_elements(p_choices) as c
       where jsonb_typeof(c) <> 'string' or length(btrim(c #>> '{}')) = 0
     );
$$;

comment on function public.policy_choices_are_valid(jsonb) is
  'True when a knowledge-check question''s choices are 2-6 non-empty strings. IMMUTABLE so it can be '
  'used from policy_campaign_questions'' CHECK constraint, which cannot hold a subquery itself.';

-- The composite target the questions table needs below. id is already the primary key, so this adds
-- no new restriction -- it exists so a child row can be tied to (campaign, organization) as one
-- fact rather than two independent references. Mirrors policy_documents_id_org_uk.
alter table public.policy_attestation_campaigns
  add constraint policy_attestation_campaigns_id_org_uk unique (id, organization_id);

create table public.policy_campaign_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.policy_attestation_campaigns(id) on delete cascade,
  -- Independent FKs on organization_id and campaign_id would let an administrator supply their own
  -- organization (which the write policy checks) alongside ANOTHER tenant's campaign id (which it
  -- does not) -- and since employee reads and the attest gate both select purely by campaign_id,
  -- that is cross-tenant question injection: attacker-controlled questions blocking or altering a
  -- different tenant's attestations. This composite FK makes the pair itself the enforced fact.
  constraint policy_campaign_questions_campaign_org_fk
    foreign key (campaign_id, organization_id)
    references public.policy_attestation_campaigns(id, organization_id) on delete cascade,
  display_order integer not null,
  prompt text not null check (length(btrim(prompt)) between 1 and 2000),
  -- jsonb array of 2..6 non-empty strings. Kept as jsonb rather than a child table because a
  -- multiple-choice option has no identity of its own -- it is never referenced, reordered
  -- independently, or reported on; it is part of the question's text.
  choices jsonb not null,
  correct_choice_index integer not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_campaign_questions_campaign_order_uk unique (campaign_id, display_order),
  constraint policy_campaign_questions_choices_shape_check check (public.policy_choices_are_valid(choices)),
  constraint policy_campaign_questions_correct_index_in_range_check check (
    correct_choice_index >= 0 and correct_choice_index < jsonb_array_length(choices)
  )
);

comment on table public.policy_campaign_questions is
  'Knowledge-check questions for one policy attestation campaign (BACKLOG.md E4). Readable only by '
  'the administrators who author them -- correct_choice_index is the answer key and must never reach '
  'an employee session. Employees read questions via get_policy_knowledge_check(), which omits it.';
comment on column public.policy_campaign_questions.correct_choice_index is
  'Zero-based index into choices. Answer key -- see the table comment; no employee-reachable query '
  'or RPC returns this column.';

create index policy_campaign_questions_campaign_idx on public.policy_campaign_questions(campaign_id);
create index policy_campaign_questions_organization_idx on public.policy_campaign_questions(organization_id);

create trigger set_updated_at before update on public.policy_campaign_questions
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.policy_campaign_questions
  for each row execute function public.audit_log_trigger();

alter table public.policy_campaign_questions enable row level security;
revoke all on table public.policy_campaign_questions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.policy_campaign_questions to authenticated;
grant all on table public.policy_campaign_questions to service_role;

-- Deliberately narrower than policy_attestation_campaigns_select (which also admits 'auditor' and
-- employees who own the attestation): this table holds the answer key, so visibility stops at the
-- roles that author campaigns. An auditor reviewing evidence reads the attempts table below, which
-- records what was answered and whether it passed, without exposing the key.
create policy policy_campaign_questions_select
on public.policy_campaign_questions for select to authenticated
using (
  public.is_platform_admin()
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager')
  )
);

create policy policy_campaign_questions_write
on public.policy_campaign_questions for insert to authenticated
with check (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
    )
  )
);

create policy policy_campaign_questions_update
on public.policy_campaign_questions for update to authenticated
using (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
    )
  )
)
with check (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
    )
  )
);

create policy policy_campaign_questions_delete
on public.policy_campaign_questions for delete to authenticated
using (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
    )
  )
);

-- ---------------------------------------------------------------------------
-- 2. Attempts (append-only evidence of every submission, passing or not)
-- ---------------------------------------------------------------------------

create table public.policy_knowledge_check_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  attestation_id uuid not null references public.policy_attestations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  -- {question_id: chosen_index}. Stored so a reviewer can see what was actually answered, not just
  -- the score -- the same reason policy_attestations keeps ip/user_agent rather than a bare boolean.
  answers jsonb not null,
  correct_count integer not null check (correct_count >= 0),
  total_count integer not null check (total_count > 0),
  passed boolean not null,
  created_at timestamptz not null default now(),
  constraint policy_knowledge_check_attempts_score_in_range_check check (correct_count <= total_count)
);

comment on table public.policy_knowledge_check_attempts is
  'Append-only record of every policy knowledge-check submission (BACKLOG.md E4), passing or failing. '
  'Written only by submit_policy_knowledge_check(); attest-policy requires a passing row here before '
  'a campaign with questions can be attested.';

create index policy_knowledge_check_attempts_attestation_idx
  on public.policy_knowledge_check_attempts(attestation_id);
create index policy_knowledge_check_attempts_employee_idx
  on public.policy_knowledge_check_attempts(employee_id);
create index policy_knowledge_check_attempts_organization_idx
  on public.policy_knowledge_check_attempts(organization_id);

alter table public.policy_knowledge_check_attempts enable row level security;
revoke all on table public.policy_knowledge_check_attempts from public, anon, authenticated, service_role;
grant select on table public.policy_knowledge_check_attempts to authenticated;
grant all on table public.policy_knowledge_check_attempts to service_role;

-- No insert/update/delete policy for authenticated at all: rows arrive only through
-- submit_policy_knowledge_check() (SECURITY DEFINER), which is what makes the score server-graded
-- rather than client-asserted. Same posture policy_attestations takes toward attest-policy.
create policy policy_knowledge_check_attempts_select
on public.policy_knowledge_check_attempts for select to authenticated
using (
  public.is_platform_admin()
  or (select public.owns_employee(employee_id))
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager', 'auditor')
  )
);

create or replace function app_private.prevent_policy_knowledge_check_attempt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Policy knowledge check attempts are append-only' using errcode = '55000';
end;
$$;

create trigger prevent_policy_knowledge_check_attempt_mutation
  before update or delete on public.policy_knowledge_check_attempts
  for each row execute function app_private.prevent_policy_knowledge_check_attempt_mutation();
create trigger prevent_policy_knowledge_check_attempt_truncate
  before truncate on public.policy_knowledge_check_attempts
  for each statement execute function app_private.prevent_policy_knowledge_check_attempt_mutation();

-- ---------------------------------------------------------------------------
-- 3. Freeze questions once an attempt has passed
-- ---------------------------------------------------------------------------

create or replace function public.lock_answered_policy_campaign_questions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_campaigns uuid[];
begin
  -- NEW is unassigned on DELETE and OLD is unassigned on INSERT; referencing the wrong one raises
  -- rather than yielding null, so branch on TG_OP instead of coalescing across them.
  --
  -- On UPDATE both sides matter, and checking only NEW would miss the sharper case: moving a
  -- question OUT of a campaign that already has a passing attempt. The destination is unfrozen so
  -- it passes, while the source silently loses a question its existing attestations were graded
  -- against -- exactly the evidence drift this trigger exists to prevent.
  if tg_op = 'DELETE' then
    v_campaigns := array[old.campaign_id];
  elsif tg_op = 'UPDATE' then
    v_campaigns := array[new.campaign_id, old.campaign_id];
  else
    v_campaigns := array[new.campaign_id];
  end if;
  if exists (
    select 1
    from public.policy_knowledge_check_attempts a
    join public.policy_attestations pa on pa.id = a.attestation_id
    where pa.campaign_id = any(v_campaigns) and a.passed
  ) then
    raise exception 'Knowledge check questions cannot change after someone has passed this campaign''s check.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger lock_answered_policy_campaign_questions
  before insert or update or delete on public.policy_campaign_questions
  for each row execute function public.lock_answered_policy_campaign_questions();

-- ---------------------------------------------------------------------------
-- 4. Employee-facing reads/writes (the only path that touches questions)
-- ---------------------------------------------------------------------------

-- Returns the campaign's questions for an attestation the CALLER owns, with the answer key omitted.
-- SECURITY DEFINER because policy_campaign_questions_select deliberately excludes employees; the
-- ownership check below is what replaces it.
create or replace function public.get_policy_knowledge_check(p_attestation_id uuid)
returns table (question_id uuid, display_order integer, prompt text, choices jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare v_campaign uuid; v_org uuid;
begin
  select pa.campaign_id, pa.organization_id into v_campaign, v_org
  from public.policy_attestations pa
  join public.employees e on e.id = pa.employee_id
  where pa.id = p_attestation_id and e.profile_id = auth.uid();

  if v_campaign is null then
    raise exception 'Attestation not found for this user' using errcode = '42501';
  end if;
  -- SECURITY DEFINER bypasses the restrictive product_module_entitlement policy on the tables this
  -- reads, so the entitlement has to be asserted here or an organization that lost the Compliance
  -- module keeps working through this RPC while ordinary table access and the route are closed.
  if not app_private.has_product_module('modules.compliance') then
    raise exception 'Compliance module is not enabled for this organization' using errcode = '42501';
  end if;

  return query
    select q.id, q.display_order, q.prompt, q.choices
    from public.policy_campaign_questions q
    where q.campaign_id = v_campaign
    order by q.display_order;
end;
$$;

comment on function public.get_policy_knowledge_check(uuid) is
  'Questions for the caller''s own attestation, without correct_choice_index. The only employee-'
  'reachable path to knowledge-check content.';

-- Grades server-side and records the attempt. Returns the score plus whether it passed; never
-- returns which specific questions were wrong (that would turn repeated attempts into an oracle
-- that reconstructs the answer key without ever reading the policy).
create or replace function public.submit_policy_knowledge_check(p_attestation_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attestation public.policy_attestations%rowtype;
  v_total integer;
  v_correct integer;
  v_passed boolean;
  v_attempt_id uuid;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be a JSON object of question id to chosen index'
      using errcode = '22023';
  end if;

  -- FOR UPDATE OF pa serializes concurrent submissions for the same attestation. Without it the
  -- attempt cap below is a check-then-act race: five parallel requests all count 0 before any of
  -- them inserts, all pass, and the cap -- the only thing bounding the score oracle -- does nothing
  -- against exactly the automated probing it exists to slow down.
  select pa.* into v_attestation
  from public.policy_attestations pa
  join public.employees e on e.id = pa.employee_id
  where pa.id = p_attestation_id and e.profile_id = auth.uid()
  for update of pa;

  if v_attestation.id is null then
    raise exception 'Attestation not found for this user' using errcode = '42501';
  end if;
  -- Same reason as get_policy_knowledge_check: SECURITY DEFINER bypasses the restrictive
  -- product_module_entitlement policy, so it has to be asserted explicitly here.
  if not app_private.has_product_module('modules.compliance') then
    raise exception 'Compliance module is not enabled for this organization' using errcode = '42501';
  end if;
  if v_attestation.status <> 'pending' then
    raise exception 'This policy has already been attested' using errcode = '55000';
  end if;

  -- Attempt cap. Returning correctCount is a deliberate product choice (a learner who fails should
  -- know how close they were), but a score plus unlimited retries is an answer-key oracle: submit a
  -- baseline, change one choice, read the delta, repeat. Capping attempts per rolling day makes
  -- systematically mapping a quiz take days instead of minutes, and every probe is a row in an
  -- append-only table administrators and auditors can see -- so the cheap covert attack becomes a
  -- slow conspicuous one. This bounds the oracle rather than eliminating it; eliminating it while
  -- still reporting a score is not possible, and the score was worth keeping.
  if (
    select count(*) from public.policy_knowledge_check_attempts a
    where a.attestation_id = v_attestation.id
      and a.created_at > now() - interval '24 hours'
  ) >= 5 then
    raise exception 'Too many knowledge check attempts for this policy today. Try again tomorrow.'
      using errcode = '53400';
  end if;

  select count(*)::int into v_total
  from public.policy_campaign_questions q
  where q.campaign_id = v_attestation.campaign_id;

  if v_total = 0 then
    raise exception 'This campaign has no knowledge check' using errcode = '22023';
  end if;

  -- A missing or non-integer answer simply scores as wrong rather than erroring: a partially
  -- completed submission is a failed attempt, which is a real thing to record, not a malformed call.
  select count(*)::int into v_correct
  from public.policy_campaign_questions q
  where q.campaign_id = v_attestation.campaign_id
    and jsonb_typeof(p_answers -> q.id::text) = 'number'
    and (p_answers ->> q.id::text)::numeric = q.correct_choice_index;

  -- Every question must be right. A policy attestation asserts the signer understood the policy;
  -- a partial-credit pass would put a record on file that says more than the check established.
  v_passed := v_correct = v_total;

  insert into public.policy_knowledge_check_attempts(
    organization_id, attestation_id, employee_id, answers, correct_count, total_count, passed
  ) values (
    v_attestation.organization_id, v_attestation.id, v_attestation.employee_id,
    p_answers, v_correct, v_total, v_passed
  ) returning id into v_attempt_id;

  return jsonb_build_object(
    'attemptId', v_attempt_id,
    'passed', v_passed,
    'correctCount', v_correct,
    'totalCount', v_total
  );
end;
$$;

comment on function public.submit_policy_knowledge_check(uuid, jsonb) is
  'Grades a knowledge-check submission server-side, records an append-only attempt, and returns the '
  'score. Requires every question correct to pass. Never reveals which questions were wrong.';

revoke all on function public.get_policy_knowledge_check(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_policy_knowledge_check(uuid) to authenticated;
revoke all on function public.submit_policy_knowledge_check(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_policy_knowledge_check(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Ratchets: module entitlement + audit manifest (see audit_manifest_covers_every_table.test.sql)
-- ---------------------------------------------------------------------------

insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values
  ('public', 'policy_campaign_questions', 'modules.compliance'),
  ('public', 'policy_knowledge_check_attempts', 'modules.compliance')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

create policy product_module_entitlement on public.policy_campaign_questions
  as restrictive for all to authenticated
  using ((select app_private.has_product_module('modules.compliance')))
  with check ((select app_private.has_product_module('modules.compliance')));

create policy product_module_entitlement on public.policy_knowledge_check_attempts
  as restrictive for all to authenticated
  using ((select app_private.has_product_module('modules.compliance')))
  with check ((select app_private.has_product_module('modules.compliance')));

insert into app_private.audit_entity_manifest (table_name, audit_mode, contains_regulated_data, rationale)
values
  (
    'policy_campaign_questions',
    'row_trigger',
    false,
    'Administrator-authored knowledge-check content for a policy campaign, including the answer key. '
    'Carries audit_log_trigger like policy_attestation_campaigns -- who changed a question, and when, '
    'is exactly what a challenged attestation record would be examined against. No resident or '
    'employee personal data.'
  ),
  (
    'policy_knowledge_check_attempts',
    'not_required',
    true,
    'Append-only record of every knowledge-check submission (answers, score, pass/fail) written only '
    'by submit_policy_knowledge_check; the table is itself the evidence trail, so a row trigger would '
    'duplicate it -- same reasoning as offline_service_draft_receipts. Flagged as regulated because '
    'it is reachable from a data subject via employee_id: whether a named person passed or failed a '
    'competency check is about that person, regardless of how little else the row holds.'
  )
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 6. Keep the answer key out of the audit log
-- ---------------------------------------------------------------------------
--
-- policy_campaign_questions carries the generic audit_log_trigger, which serializes the whole row
-- into audit_logs.old_values/new_values -- correct_choice_index included. audit_logs_select gives
-- same-organization auditors org-wide read, and this migration deliberately keeps auditors OUT of
-- policy_campaign_questions precisely so the answer key stays hidden from them. Without this, the
-- key is recoverable from the audit trail by exactly the role the select policy excludes.
--
-- Redacting the value rather than dropping the trigger is the better trade: who changed a question
-- and when is the thing a challenged attestation would actually be examined against, so the trail
-- is worth keeping. Only the answer itself has to go.
--
-- Extending the shared redactor (rather than special-casing this table) means any future table that
-- names a column correct_choice_index inherits the same protection. Existing rows are not rewritten
-- -- redaction applies to new evidence from this point, the same caveat the original redactor
-- documents for its own key list.
create or replace function app_private.redact_audit_json(p_value jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_value is null then
    return null;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    select coalesce(
      jsonb_object_agg(
        e.key,
        case
          when lower(e.key) ~ '(^|_)(password|secret|auth_token|access_token|refresh_token|token_hash|checkin_pin_hash|api_key|encrypted_password|credential_hash|verification_challenge|salt|correct_choice_index)($|_)'
            then '"[REDACTED]"'::jsonb
          else app_private.redact_audit_json(e.value)
        end
      ),
      '{}'::jsonb
    )
    into v_result
    from jsonb_each(p_value) as e;
    return v_result;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    select coalesce(
      jsonb_agg(app_private.redact_audit_json(a.value) order by a.ordinality),
      '[]'::jsonb
    )
    into v_result
    from jsonb_array_elements(p_value) with ordinality as a(value, ordinality);
    return v_result;
  end if;

  return p_value;
end;
$$;

revoke all on function app_private.redact_audit_json(jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Create a campaign and its questions atomically
-- ---------------------------------------------------------------------------
--
-- The client originally inserted the campaign, then the questions, as two round trips. If the
-- second failed -- transient network error, a question row the constraints reject -- the campaign
-- stayed committed and looked exactly like a read-and-sign campaign. Assigning it then let staff
-- attest with no knowledge check at all, silently, with nothing to tell the administrator their
-- questions never landed. That is the same silent-degradation shape this feature exists to prevent.
--
-- A plpgsql function body is a single transaction, so both inserts commit together or neither does.
--
-- SECURITY INVOKER (not DEFINER) on purpose: every RLS policy on both tables applies to the caller
-- exactly as it does for a direct insert, including identity_assurance_is_current('policy_document_admin')
-- and the restrictive entitlement check. There is no authorization logic duplicated here to drift
-- from the policies, and no definer context to accidentally widen.
create or replace function public.create_policy_campaign_with_questions(
  p_organization_id uuid,
  p_policy_document_id uuid,
  p_policy_document_version_id uuid,
  p_name text,
  p_due_date date default null,
  p_questions jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign_id uuid;
  v_question jsonb;
  v_order integer := 0;
begin
  if p_questions is not null and jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Questions must be a JSON array' using errcode = '22023';
  end if;

  insert into public.policy_attestation_campaigns (
    organization_id, policy_document_id, policy_document_version_id, name, due_date, created_by
  ) values (
    p_organization_id, p_policy_document_id, p_policy_document_version_id,
    btrim(p_name), p_due_date, auth.uid()
  )
  returning id into v_campaign_id;

  for v_question in select * from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb))
  loop
    v_order := v_order + 1;
    insert into public.policy_campaign_questions (
      organization_id, campaign_id, display_order, prompt, choices, correct_choice_index, created_by
    ) values (
      p_organization_id, v_campaign_id, v_order,
      v_question ->> 'prompt',
      v_question -> 'choices',
      (v_question ->> 'correct_choice_index')::integer,
      auth.uid()
    );
  end loop;

  return v_campaign_id;
end;
$$;

comment on function public.create_policy_campaign_with_questions(uuid, uuid, uuid, text, date, jsonb) is
  'Creates an attestation campaign and its knowledge-check questions in one transaction, so a '
  'campaign can never be left committed without the questions its author wrote. SECURITY INVOKER: '
  'the tables'' own RLS policies authorize the caller.';

revoke all on function public.create_policy_campaign_with_questions(uuid, uuid, uuid, text, date, jsonb)
  from public, anon, service_role;
grant execute on function public.create_policy_campaign_with_questions(uuid, uuid, uuid, text, date, jsonb)
  to authenticated;
