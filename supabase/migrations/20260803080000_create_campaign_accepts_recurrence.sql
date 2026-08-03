-- Let campaign creation set a recurrence, so the series can actually be authored.
--
-- 20260803070000 added the series columns and the spawn job; nothing could create a recurring
-- campaign. Same reasoning as 20260803060000: one creation path, not a second one.
--
-- next_occurrence_on is DERIVED here rather than accepted. The campaign being created is cycle
-- one, so the next cycle is its own due date plus the interval -- asking the caller for both a
-- due date and a next-occurrence date invites them to disagree, and a series whose next date sits
-- before its own first due date would spawn cycle two immediately.
--
-- That derivation is why recurrence requires a due date: without one there is no anchor to count
-- from, and policy_campaign_recurrence_shape_check would reject the row with a message about a
-- column the caller never supplied. Raising here says the actual thing.
--
-- Rollback: drop this function, then CREATE OR REPLACE the eleven-parameter version from
-- 20260803060000.

drop function if exists public.create_policy_campaign_with_questions(
  uuid, uuid, uuid, text, date, jsonb, text, uuid[], text, text, text);

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
  p_target_job_title_pattern text default null,
  p_recurrence_months integer default null
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_campaign_id uuid;
  v_question jsonb;
  v_order integer := 0;
  v_next_occurrence date;
begin
  if p_questions is not null and jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Questions must be a JSON array' using errcode = '22023';
  end if;

  if p_recurrence_months is not null then
    if p_due_date is null then
      raise exception 'A repeating campaign needs a due date to repeat from'
        using errcode = '22023';
    end if;
    v_next_occurrence := p_due_date + make_interval(months => p_recurrence_months);
  end if;

  insert into public.policy_attestation_campaigns (
    organization_id, policy_document_id, policy_document_version_id, name, due_date, created_by,
    targeting_mode, target_facility_ids, target_facility_type, target_worker_type,
    target_job_title_pattern, recurrence_months, next_occurrence_on
  ) values (
    p_organization_id, p_policy_document_id, p_policy_document_version_id,
    btrim(p_name), p_due_date, auth.uid(),
    coalesce(p_targeting_mode, 'manual'), p_target_facility_ids, p_target_facility_type,
    p_target_worker_type, p_target_job_title_pattern, p_recurrence_months, v_next_occurrence
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

  perform public.materialize_policy_campaign_targets(v_campaign_id);

  return v_campaign_id;
end;
$function$;

comment on function public.create_policy_campaign_with_questions(
  uuid, uuid, uuid, text, date, jsonb, text, uuid[], text, text, text, integer
) is
  'Creates a policy attestation campaign, its knowledge-check questions, its declarative '
  'enrolment and its recurrence schedule in one transaction. SECURITY INVOKER, so both tables'' '
  'RLS policies authorize the caller exactly as a direct insert would. BACKLOG.md E4.';

-- DROP discards the ACL; without this the function would keep only PostgreSQL's implicit
-- EXECUTE-to-PUBLIC default, which is wider than what the dropped one carried.
revoke all on function public.create_policy_campaign_with_questions(
  uuid, uuid, uuid, text, date, jsonb, text, uuid[], text, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.create_policy_campaign_with_questions(
  uuid, uuid, uuid, text, date, jsonb, text, uuid[], text, text, text, integer
) to authenticated;
