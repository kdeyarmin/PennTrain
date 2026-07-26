-- One support-plan proposal engine, combining the two that existed.
--
-- THE SITUATION. Two engines proposed support-plan changes, and each held half of what the product
-- needs:
--
--   * public.generate_support_plan_proposal(assessment_form_id, reason) -- 20260714100000, later
--     re-pointed by 20260726020100. The one the UI calls. Keyed on the assessment FORM, which is
--     what the product actually produces, and emitting proposedNeeds/proposedServices/
--     proposedInterventions/proposedDme -- the shape review_support_plan_proposal() merges into the
--     draft plan. But it selected EVERY active mapping rule without ever comparing a rule's
--     `condition` to the resident's answers. With no rules seeded that was invisible; the moment
--     rules exist it would propose every intervention in the pack for every resident.
--
--   * public.generate_support_plan_proposal_from_review(review_id, reason) -- 20260726040000. Never
--     called from anywhere. It DID evaluate conditions, and it carried per-item provenance (which
--     rule, which version, which answer, and the rule's rationale) so a reviewer could see why each
--     item was suggested. But it emitted `items[]`, a shape the plan merge cannot read, so
--     accepting one of its proposals would have merged nothing into the plan.
--
-- WHAT THIS DOES. Keeps the live entry point and the plan-compatible output, adds the evaluation
-- step and the provenance, and drops the dead engine. After this there is one function.
--
-- Three specific improvements over either predecessor:
--
--   1. Conditions are evaluated against the resident's own answers, so a proposal contains only
--      rules that actually fired. This is the fix the 20260726040000 header described.
--   2. Answers are read from the assessment form's nested `content` (flattened to dotted paths) AND
--      from the resident's most recent FINAL assessment review, with review answers winning. That
--      is what "combine both" means for inputs: a rule can address either source by key, and the
--      review path stops being unreachable without becoming the only path.
--   3. Every proposed entry is stamped with `key` = the rule key. app_private.merge_plan_entries()
--      dedupes on `key`, so accepting the same proposal twice no longer appends duplicate needs and
--      services. Neither predecessor stamped a key, so every accept was additive.
--
-- The proposal keeps `items[]` alongside the proposed* arrays: the arrays are what reaches the
-- plan, and `items` is the evidence for the human deciding. A proposal a reviewer cannot interrogate
-- is a recommendation with no argument behind it.
--
-- Rollback: restore generate_support_plan_proposal from 20260726020100 and
-- generate_support_plan_proposal_from_review from 20260726040000; both bodies are intact there.

-- ---------------------------------------------------------------------------
-- Answer normalisation
-- ---------------------------------------------------------------------------

-- Assessment form content is nested (section1.items.bathing.degree); review answers are flat. Rules
-- address a single `assessment_item_key`, so both are flattened to dotted paths before matching.
--
-- Objects are walked; arrays are left as whole values at their own path. Assessment conditions are
-- written against scalars, and inventing an index syntax nobody writes rules against would be a
-- guess dressed as a feature.
create or replace function app_private.flatten_assessment_answers(p_content jsonb, p_prefix text default '')
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(flat.key, flat.value) filter (where flat.key is not null),
    '{}'::jsonb
  )
  from (
    select
      case when jsonb_typeof(entry.value) = 'object' then null
           else case when p_prefix = '' then entry.key else p_prefix || '.' || entry.key end
      end as key,
      entry.value
    from jsonb_each(case when jsonb_typeof(p_content) = 'object' then p_content else '{}'::jsonb end)
      as entry
    union all
    -- Recurse into nested objects, carrying the dotted prefix down.
    select nested.key, nested.value
    from jsonb_each(case when jsonb_typeof(p_content) = 'object' then p_content else '{}'::jsonb end)
      as entry,
      lateral jsonb_each(
        app_private.flatten_assessment_answers(
          entry.value,
          case when p_prefix = '' then entry.key else p_prefix || '.' || entry.key end
        )
      ) as nested
    where jsonb_typeof(entry.value) = 'object'
  ) as flat;
$$;
revoke all on function app_private.flatten_assessment_answers(jsonb, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The single engine
-- ---------------------------------------------------------------------------

create or replace function public.generate_support_plan_proposal(
  p_assessment_form_id uuid,
  p_reason text default 'Assessment change requires support-plan review'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assess public.resident_assessment_forms%rowtype;
  v_res public.residents%rowtype;
  v_review public.resident_assessment_reviews%rowtype;
  v_current uuid;
  v_id uuid;
  v_work uuid;
  v_answers jsonb;
  v_rule record;
  v_answer jsonb;
  v_items jsonb := '[]'::jsonb;
  v_needs jsonb := '[]'::jsonb;
  v_services jsonb := '[]'::jsonb;
  v_interventions jsonb := '[]'::jsonb;
  v_dme jsonb := '[]'::jsonb;
begin
  select * into v_assess from public.resident_assessment_forms where id = p_assessment_form_id;
  if not found then raise exception 'Assessment not found' using errcode = 'P0002'; end if;
  select * into v_res from public.residents where id = v_assess.resident_id;
  perform app_private.assert_resident_care_manager(v_res.organization_id, v_res.facility_id);

  select id into v_current from public.resident_support_plans
  where resident_id = v_res.id and state = 'active'
  order by effective_date desc limit 1;

  -- The form's own content, then the latest finalized review layered on top. The review is the more
  -- recent structured judgement about the same resident, so where both answer a key it wins.
  select * into v_review from public.resident_assessment_reviews
  where resident_id = v_res.id and status = 'final'
  order by review_date desc, created_at desc limit 1;

  v_answers := app_private.flatten_assessment_answers(v_assess.content)
    || app_private.flatten_assessment_answers(coalesce(v_review.answers, '{}'::jsonb));

  -- Only rules whose condition matches the resident's answer contribute. Ordering by rule_key and
  -- descending version keeps the newest version of a rule first, matching how the rules table is
  -- versioned.
  for v_rule in
    select r.*
    from public.support_plan_assessment_mapping_rules r
    where r.is_active
      and (r.organization_id is null or r.organization_id = v_res.organization_id)
      and (r.facility_id is null or r.facility_id = v_res.facility_id)
      and current_date between r.effective_from and coalesce(r.effective_to, current_date)
    order by r.rule_key, r.version desc
  loop
    v_answer := v_answers -> v_rule.assessment_item_key;
    if app_private.mapping_rule_condition_matches(v_rule.condition, v_answer) then
      -- Provenance: what fired, on which answer, and the rule's own stated reason.
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'ruleKey', v_rule.rule_key,
        'ruleVersion', v_rule.version,
        'assessmentItemKey', v_rule.assessment_item_key,
        'answer', v_answer,
        'rationale', v_rule.rationale
      ));

      -- Stamped with `key` so merge_plan_entries can dedupe. The rule's own object is on the RIGHT
      -- of `||`, so a rule that already curates its own key keeps it -- the seeded PA rules do
      -- exactly this ("ambulation_support" rather than "pa.mobility.standby_ambulation"), and two
      -- rules deliberately sharing a key must stay one plan entry. The rule_key is the fallback for
      -- rules that specify none, which previously produced key-less entries that merged additively
      -- on every accept.
      --
      -- An empty proposed_* object means the rule does not propose that kind of change; adding
      -- `{"key": ...}` alone would put an empty need on the plan.
      if v_rule.proposed_need <> '{}'::jsonb then
        v_needs := v_needs || jsonb_build_array(
          jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_need);
      end if;
      if v_rule.proposed_service <> '{}'::jsonb then
        v_services := v_services || jsonb_build_array(
          jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_service);
      end if;
      if v_rule.proposed_intervention <> '{}'::jsonb then
        v_interventions := v_interventions || jsonb_build_array(
          jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_intervention);
      end if;
      if v_rule.proposed_dme <> '{}'::jsonb then
        v_dme := v_dme || jsonb_build_array(
          jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_dme);
      end if;
    end if;
  end loop;

  insert into public.support_plan_proposals(
    organization_id, facility_id, resident_id, assessment_form_id, current_plan_id,
    proposal, conflict_warnings, rationale, owner_profile_id, due_at
  ) values (
    v_res.organization_id, v_res.facility_id, v_res.id, v_assess.id, v_current,
    jsonb_build_object(
      'source', 'assessment_mapping_rules',
      'assessmentFormId', v_assess.id,
      'reviewId', v_review.id,
      'items', v_items,
      'proposedNeeds', v_needs,
      'proposedServices', v_services,
      'proposedInterventions', v_interventions,
      'proposedDme', v_dme
    ),
    case when v_current is null then array['No support plan is currently in force.']::text[]
         else array[]::text[] end,
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
  ) values (
    v_res.organization_id, v_res.facility_id, 'rule_exception', v_id,
    'support-plan-proposal:' || v_id, 'Review support-plan proposal',
    'Assessment information suggests the support plan may need human review.',
    auth.uid(), 'high', now() + interval '3 days', 'open', auth.uid()
  )
  on conflict (organization_id, deduplication_key) do update set updated_at = now()
  returning id into v_work;
  update public.support_plan_proposals set work_item_id = v_work where id = v_id;

  insert into public.audit_logs(
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_res.organization_id, auth.uid(), 'support_plan_proposal', v_id::text,
    'support_plan.proposal_generated',
    jsonb_build_object(
      'assessmentFormId', v_assess.id,
      'reviewId', v_review.id,
      'matchedRules', jsonb_array_length(v_items),
      'workItemId', v_work));

  return v_id;
end $$;
revoke all on function public.generate_support_plan_proposal(uuid, text) from public, anon;
grant execute on function public.generate_support_plan_proposal(uuid, text)
  to authenticated, service_role;

-- The review-keyed engine is now redundant: its evaluation and provenance live above, reachable
-- from the entry point the product actually calls. Dropping it rather than leaving it dead means
-- there is one answer to "how does a proposal get made".
drop function if exists public.generate_support_plan_proposal_from_review(uuid, text);
