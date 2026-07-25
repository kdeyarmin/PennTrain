begin;
select plan(22);

-- The condition evaluator is the step the previous proposal engine was missing entirely: it
-- aggregated every active rule without ever comparing a rule's condition to the assessment. These
-- assertions pin the evaluation semantics, especially the cases where a rule must NOT fire.

-- equals -------------------------------------------------------------------
select ok(
  app_private.mapping_rule_condition_matches('{"equals": ["two_person","mechanical_lift"]}'::jsonb, '"two_person"'::jsonb),
  'equals matches a listed value'
);
select ok(
  not app_private.mapping_rule_condition_matches('{"equals": ["two_person"]}'::jsonb, '"one_person"'::jsonb),
  'equals does not match an unlisted value'
);

-- notEquals ----------------------------------------------------------------
select ok(
  app_private.mapping_rule_condition_matches('{"notEquals": ["regular"]}'::jsonb, '"pureed"'::jsonb),
  'notEquals matches a value outside the list'
);
select ok(
  not app_private.mapping_rule_condition_matches('{"notEquals": ["regular"]}'::jsonb, '"regular"'::jsonb),
  'notEquals does not match a listed value'
);

-- numeric ------------------------------------------------------------------
select ok(
  app_private.mapping_rule_condition_matches('{"gte": 2}'::jsonb, '2'::jsonb),
  'gte matches at the boundary'
);
select ok(
  not app_private.mapping_rule_condition_matches('{"gte": 2}'::jsonb, '1'::jsonb),
  'gte does not match below the boundary'
);
select ok(
  app_private.mapping_rule_condition_matches('{"lte": 5}'::jsonb, '5'::jsonb),
  'lte matches at the boundary'
);
select ok(
  not app_private.mapping_rule_condition_matches('{"gte": 2, "lte": 4}'::jsonb, '9'::jsonb),
  'a bounded range rejects a value above it'
);
select ok(
  not app_private.mapping_rule_condition_matches('{"gte": 2}'::jsonb, '"two"'::jsonb),
  'a numeric condition does not match a string answer'
);

-- boolean ------------------------------------------------------------------
select ok(
  app_private.mapping_rule_condition_matches('{"isTrue": false}'::jsonb, 'false'::jsonb),
  'isTrue:false matches a false answer'
);
select ok(
  not app_private.mapping_rule_condition_matches('{"isTrue": false}'::jsonb, 'true'::jsonb),
  'isTrue:false does not match a true answer'
);
select ok(
  app_private.mapping_rule_condition_matches('{"isTrue": true}'::jsonb, 'true'::jsonb),
  'isTrue:true matches a true answer'
);
select ok(
  not app_private.mapping_rule_condition_matches('{"isTrue": true}'::jsonb, '"true"'::jsonb),
  'a boolean condition does not match a string answer'
);

-- absence ------------------------------------------------------------------
-- A rule must fire on evidence, never on a question nobody answered.
select ok(
  not app_private.mapping_rule_condition_matches('{"equals": ["two_person"]}'::jsonb, null),
  'an unanswered field never matches'
);
select ok(
  not app_private.mapping_rule_condition_matches('{"equals": ["two_person"]}'::jsonb, 'null'::jsonb),
  'a json null answer never matches'
);
select ok(
  not app_private.mapping_rule_condition_matches('{"equals": ["two_person"]}'::jsonb, '""'::jsonb),
  'a blank answer never matches'
);
select ok(
  app_private.mapping_rule_condition_matches('{}'::jsonb, '"anything"'::jsonb),
  'an empty condition matches any answered value'
);
select ok(
  not app_private.mapping_rule_condition_matches('{}'::jsonb, null),
  'an empty condition still does not match an unanswered field'
);

-- seeded rule pack ---------------------------------------------------------
select ok(
  (select count(*) from public.support_plan_assessment_mapping_rules
    where organization_id is null and facility_id is null and is_active) >= 10,
  'the platform PA rule pack is seeded'
);
select ok(
  not exists (
    select 1 from public.support_plan_assessment_mapping_rules
    where length(btrim(coalesce(rationale, ''))) < 20
  ),
  'every mapping rule carries a rationale explaining why it was suggested'
);

-- The worked example from the product request: extensive toileting assistance (no scheduled
-- toileting in place), two recent falls, a walker, and unreliable requests for help should match
-- exactly the six interventions the request names.
select is(
  (
    select count(*)::int
    from public.support_plan_assessment_mapping_rules r
    where r.is_active
      and r.organization_id is null
      and app_private.mapping_rule_condition_matches(
        r.condition,
        jsonb_build_object(
          'scheduled_toileting', to_jsonb(false),
          'requests_assistance_reliably', to_jsonb(false),
          'transfer_assistance', to_jsonb('one_person'::text),
          'ambulation_status', to_jsonb('walker'::text),
          'falls_last_90_days', to_jsonb(2)
        ) -> r.assessment_item_key
      )
  ),
  6,
  'the worked example matches exactly the six proposed interventions the request names'
);

-- A resident with none of those findings must match nothing: an engine that proposes the whole
-- pack regardless of the assessment is worse than no engine.
select is(
  (
    select count(*)::int
    from public.support_plan_assessment_mapping_rules r
    where r.is_active
      and r.organization_id is null
      and app_private.mapping_rule_condition_matches(
        r.condition,
        jsonb_build_object(
          'scheduled_toileting', to_jsonb(true),
          'requests_assistance_reliably', to_jsonb(true),
          'transfer_assistance', to_jsonb('independent'::text),
          'ambulation_status', to_jsonb('independent'::text),
          'falls_last_90_days', to_jsonb(0),
          'diet_texture', to_jsonb('regular'::text),
          'fall_risk', to_jsonb('low'::text),
          'elopement_risk', to_jsonb('none'::text)
        ) -> r.assessment_item_key
      )
  ),
  0,
  'an independent resident with no findings matches no rules'
);

select * from finish();
rollback;
