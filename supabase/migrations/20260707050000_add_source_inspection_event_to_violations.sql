-- Bridges the gap between recurring facility inspections (inspection_items/inspection_events --
-- equipment checks, fire drills) and DHS-cited violations (dhs_violations), which previously had no
-- connection at all: a fail/deficiency_noted inspection event could not become a violation without
-- manually re-typing facility/date/description into a separate form. Purely additive/nullable, no
-- backfill needed. `on delete set null` (not cascade) so a violation record is never destroyed if its
-- source inspection event is later removed -- the violation itself remains the authoritative
-- compliance record regardless of what happens to the equipment-check log that originated it.
alter table public.dhs_violations
  add column source_inspection_event_id uuid references public.inspection_events(id) on delete set null;

-- Enforce that any linked source inspection event belongs to the same org/facility as the violation.
create or replace function public.validate_dhs_violation_source_event_scope()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_org uuid; v_fac uuid;
begin
  if new.source_inspection_event_id is null then return new; end if;
  select organization_id, facility_id into v_org, v_fac from public.inspection_events where id = new.source_inspection_event_id;
  if v_org is null or v_org <> new.organization_id or v_fac <> new.facility_id then
    raise exception 'source inspection event % must match violation organization/facility', new.source_inspection_event_id using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger dhs_violations_validate_source_event_scope
before insert or update of source_inspection_event_id, organization_id, facility_id on public.dhs_violations
for each row execute function public.validate_dhs_violation_source_event_scope();

create unique index dhs_violations_source_event_idx on public.dhs_violations(source_inspection_event_id)
  where source_inspection_event_id is not null;
