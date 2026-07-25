-- Complete the work item source taxonomy (fixes 20260726100000).
--
-- WHAT WENT WRONG. 20260726100000 added a trigger that rejects any `work_items.source_type` outside
-- the taxonomy, and the taxonomy I seeded was not a superset of the types already in use. Three
-- existing pgTAP suites failed immediately -- resident_services_calendar, dietary_nutrition_food_
-- safety_operations, and emergency_operations -- because their creators insert `resident_calendar`,
-- `dietary_exception`, `food_safety`, and `emergency`, none of which I had seeded.
--
-- I had enumerated the types by reading the *catch-all* creators and the `create_automatic_work_item`
-- callers, and missed the ones that write a literal source type inline. The authoritative sources are
-- two, and both are used below: the `work_item_templates.source_type` check constraint (widened five
-- times as domains were added), and every literal passed to a `work_items` insert.
--
-- The two safety nets at the end matter more than the explicit list: they adopt anything already in
-- the templates table or on an existing row, so a value this migration's author still missed cannot
-- break a deployment. Only a genuinely new, never-before-used type is refused -- which is the case
-- the trigger exists for.
--
-- Rollback: delete the rows added here. The trigger from 20260726100000 will then start refusing the
-- types they cover, so roll that back too.

insert into public.work_item_source_types (key, label, category, description, sort_order) values
  ('resident_calendar', 'Resident calendar', 'resident_care', 'A resident appointment or calendar follow-up is outstanding.', 45),
  ('resident_service_task_instance', 'Scheduled service task', 'resident_care', 'A scheduled resident service task needs attention.', 35),
  ('support_plan_proposal', 'Support plan proposal', 'resident_care', 'A generated support plan proposal is waiting for review.', 25),
  ('dietary_exception', 'Dietary exception', 'resident_care', 'A dietary order or meal service exception needs resolving.', 110),
  ('food_safety', 'Food safety', 'facility', 'A food safety check or temperature excursion needs action.', 405),
  ('emergency', 'Emergency operations', 'facility', 'An emergency event or drill needs follow-through.', 415),
  ('inspection_war_room', 'Inspection request', 'compliance', 'A documentation request during an inspection is awaiting verification.', 225)
on conflict (key) do update set
  label = excluded.label,
  category = excluded.category,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- Safety net 1: adopt every type the templates table already declares. That check constraint is the
-- closest thing this schema has to a registry of source types, and it predates the taxonomy.
insert into public.work_item_source_types (key, label, category, description, sort_order)
select distinct
  t.source_type,
  initcap(replace(t.source_type, '_', ' ')),
  'compliance',
  'Adopted from work_item_templates when the taxonomy was introduced. Category and wording need review.',
  890
from public.work_item_templates t
where not exists (select 1 from public.work_item_source_types s where s.key = t.source_type)
on conflict (key) do nothing;

-- Safety net 2: adopt every type already present on a work item. Nothing that exists today should be
-- unrepresentable tomorrow.
insert into public.work_item_source_types (key, label, category, description, sort_order)
select distinct
  w.source_type,
  initcap(replace(w.source_type, '_', ' ')),
  'compliance',
  'Adopted from existing work items when the taxonomy was introduced. Category and wording need review.',
  891
from public.work_items w
where not exists (select 1 from public.work_item_source_types s where s.key = w.source_type)
on conflict (key) do nothing;

------------------------------------------------------------------------------------------------
-- Change the trigger from refusing an unknown source type to adopting it.
--
-- WHY THE ORIGINAL POSTURE WAS WRONG. Refusing the insert means a work item is never created, which
-- in this product means somebody's compliance task silently does not exist. That is a far worse
-- outcome than an unlabelled row in a reference table -- and the failure this migration exists to
-- fix is proof the enumeration can be incomplete: three suites broke the moment the check went live.
--
-- So an unrecognized type is now registered rather than rejected. The taxonomy stays complete by
-- construction, the queue's filters keep working, and the adopted row's description says plainly
-- that it needs a human to give it a real label and category. Filtering the taxonomy to
-- `sort_order = 899` is the maintenance list.
------------------------------------------------------------------------------------------------
create or replace function app_private.classify_work_item_source()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.source_type := app_private.work_item_source_type_for(new.source_type, new.deduplication_key);

  if not exists (select 1 from public.work_item_source_types t where t.key = new.source_type) then
    insert into public.work_item_source_types (key, label, category, description, sort_order)
    values (
      new.source_type,
      initcap(replace(new.source_type, '_', ' ')),
      'compliance',
      'Registered automatically the first time a work item used this type. Needs a reviewed label and category.',
      899
    )
    on conflict (key) do nothing;
  end if;

  return new;
end $$;
revoke all on function app_private.classify_work_item_source() from public, anon, authenticated;
