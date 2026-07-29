-- Register inspection response-room requests in the universal work-item taxonomy.
--
-- `add_inspection_war_room_request` has always written source_type = 'inspection_war_room'. The
-- later source-taxonomy trigger correctly rejects values that are not registered, but the original
-- taxonomy seed omitted this one value. The result is that opening a request in Value Center can fail
-- at the work-item insert even though the request workflow and route both exist.
--
-- This forward migration fixes the seam without editing either deployed migration. It also aligns the
-- system work-item template and keeps any historical catch-all rows actionable.

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
end $$;
