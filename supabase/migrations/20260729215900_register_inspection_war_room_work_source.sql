-- Register inspection response-room requests in the universal work-item taxonomy.
--
-- `add_inspection_war_room_request` has always written source_type = 'inspection_war_room'. The
-- later source-taxonomy trigger correctly governs work-item values, but the original taxonomy seed
-- omitted this one value and `work_item_templates` still carried a separate hard-coded CHECK list.
-- The result was two sources of truth: adding a legitimate taxonomy value could still be rejected by
-- the template table before the work-item trigger ever ran.
--
-- This forward migration registers the missing value and replaces the brittle template CHECK with a
-- foreign key to the taxonomy. Future source types now have one governed registration path instead of
-- another cumulative CHECK list that can fall behind.

insert into public.work_item_source_types(key, label, category, description, sort_order, active)
values (
  'inspection_war_room',
  'Inspection response request',
  'compliance',
  'A survey, inspection, or complaint-response room has an open documentation request.',
  225,
  true
)
on conflict (key) do update set
  label = excluded.label,
  category = excluded.category,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true;

-- The taxonomy migration already adopted every source present in templates and work items. Repeat the
-- adoption defensively before adding the FK so an environment with historical customer-defined
-- templates converges rather than failing the migration. `compliance` is the conservative allowed
-- fallback category; already-registered values keep their reviewed category through ON CONFLICT.
insert into public.work_item_source_types(key, label, category, description, sort_order, active)
select distinct
  t.source_type,
  initcap(replace(t.source_type, '_', ' ')),
  'compliance',
  'Adopted from an existing work-item template; review and classify this source type.',
  900,
  true
from public.work_item_templates t
where t.source_type is not null
on conflict (key) do nothing;

alter table public.work_item_templates
  drop constraint if exists work_item_templates_source_type_check;
alter table public.work_item_templates
  drop constraint if exists work_item_templates_source_type_fkey;
alter table public.work_item_templates
  add constraint work_item_templates_source_type_fkey
  foreign key (source_type) references public.work_item_source_types(key)
  on update cascade;

update public.work_item_templates
set source_type = 'inspection_war_room', updated_at = now()
where organization_id is null
  and template_key = 'inspection.war_room_request'
  and source_type is distinct from 'inspection_war_room';

update public.work_items
set source_type = 'inspection_war_room', updated_at = now()
where source_type = 'rule_exception'
  and deduplication_key like 'inspection-war-room:%';

do $$
begin
  if not exists (
    select 1 from public.work_item_source_types
    where key = 'inspection_war_room'
      and category = 'compliance'
      and active
  ) then
    raise exception 'inspection_war_room source taxonomy registration failed';
  end if;

  if exists (
    select 1 from public.work_item_templates
    where organization_id is null
      and template_key = 'inspection.war_room_request'
      and source_type <> 'inspection_war_room'
  ) then
    raise exception 'inspection war-room template source type remains inconsistent';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'work_item_templates'
      and c.conname = 'work_item_templates_source_type_fkey'
      and c.contype = 'f'
  ) then
    raise exception 'work-item template source taxonomy foreign key is missing';
  end if;
end $$;
