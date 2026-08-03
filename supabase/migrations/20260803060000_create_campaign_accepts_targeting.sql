-- Let campaign creation set a declarative target, in the same transaction.
--
-- 20260803050000 added the target definition and the daily sweep; nothing could author one. This
-- extends the existing creation RPC rather than adding a second path, for the reason the RPC
-- exists at all: 20260802070000 replaced a create-then-insert sequence because a failure partway
-- through left a committed campaign that looked read-and-sign and let staff attest with no
-- knowledge check. A create-then-set-targeting sequence has the same shape -- it would leave a
-- committed campaign that looks manual, silently enrolling nobody.
--
-- It also materializes immediately. Waiting for the 11:00 sweep would mean an administrator
-- creates a campaign targeting forty aides, sees zero assignments, and reasonably concludes it is
-- broken. The daily job is what keeps membership true as the roster moves; it is not the thing
-- that makes the campaign start working.
--
-- The signature gains five defaulted parameters, so every existing call site is unaffected. The
-- old signature is dropped rather than left alongside: two overloads differing only by defaulted
-- trailing parameters make an unqualified call ambiguous, and PostgREST would have to guess.
--
-- Rollback: drop this function, then CREATE OR REPLACE the six-parameter version from
-- 20260802070000.

drop function if exists public.create_policy_campaign_with_questions(uuid, uuid, uuid, text, date, jsonb);

create or replace function public.create_policy_campaign_with_questions(
  p_organization_id uuid,
  p_policy_document_id uuid,
  p_policy_document_version_id uuid,
  p_name text,
  p_due_date date default null,
  p_questions jsonb default '[]'::jsonb,
  p_targeting_mode text default 'manual',
  p_target_facility_ids uuid[] default null,
  p_target_facility_type text default null,
  p_target_worker_type text default null,
  p_target_job_title_pattern text default null
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_campaign_id uuid;
  v_question jsonb;
  v_order integer := 0;
begin
  if p_questions is not null and jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Questions must be a JSON array' using errcode = '22023';
  end if;

  -- Column CHECKs still own the vocabulary (targeting_mode values, facility/worker types, and
  -- policy_campaign_targeting_predicate_check's "a declarative campaign must name a predicate").
  -- Nothing is re-validated here; a bad combination raises from the insert below, which is the
  -- one place that rule is written down.
  insert into public.policy_attestation_campaigns (
    organization_id, policy_document_id, policy_document_version_id, name, due_date, created_by,
    targeting_mode, target_facility_ids, target_facility_type, target_worker_type,
    target_job_title_pattern
  ) values (
    p_organization_id, p_policy_document_id, p_policy_document_version_id,
    btrim(p_name), p_due_date, auth.uid(),
    coalesce(p_targeting_mode, 'manual'), p_target_facility_ids, p_target_facility_type,
    p_target_worker_type, p_target_job_title_pattern
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

  -- Enrol the initial roster now. materialize_policy_campaign_targets returns 0 for a manual
  -- campaign, so this is a no-op on the existing path.
  perform public.materialize_policy_campaign_targets(v_campaign_id);

  return v_campaign_id;
end;
$function$;

comment on function public.create_policy_campaign_with_questions(
  uuid, uuid, uuid, text, date, jsonb, text, uuid[], text, text, text
) is
  'Creates a policy attestation campaign, its knowledge-check questions, and its initial '
  'declarative enrolment in one transaction. SECURITY INVOKER, so both tables'' RLS policies '
  'authorize the caller exactly as a direct insert would. BACKLOG.md E4.';

-- Re-assert the access boundary. DROP discards the old function's ACL, so without this the new
-- function would keep only PostgreSQL's implicit EXECUTE-to-PUBLIC default -- strictly wider than
-- the {authenticated} the dropped one carried.
revoke all on function public.create_policy_campaign_with_questions(
  uuid, uuid, uuid, text, date, jsonb, text, uuid[], text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_policy_campaign_with_questions(
  uuid, uuid, uuid, text, date, jsonb, text, uuid[], text, text, text
) to authenticated;
