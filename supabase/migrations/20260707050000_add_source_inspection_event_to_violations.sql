-- Bridges the gap between recurring facility inspections (inspection_items/inspection_events --
-- equipment checks, fire drills) and DHS-cited violations (dhs_violations), which previously had no
-- connection at all: a fail/deficiency_noted inspection event could not become a violation without
-- manually re-typing facility/date/description into a separate form. Purely additive/nullable, no
-- backfill needed. `on delete set null` (not cascade) so a violation record is never destroyed if its
-- source inspection event is later removed -- the violation itself remains the authoritative
-- compliance record regardless of what happens to the equipment-check log that originated it.
alter table public.dhs_violations
  add column source_inspection_event_id uuid references public.inspection_events(id) on delete set null;

-- Unique (not just indexed) so two managers racing the same finding, or a direct API caller, can't
-- both insert a violation for it -- the client's "already has a violation" check happens before
-- insert and is otherwise raceable. Partial (where not null) since most violations have no source
-- event at all and null source_inspection_event_id must remain unconstrained.
create unique index dhs_violations_source_event_idx on public.dhs_violations(source_inspection_event_id)
  where source_inspection_event_id is not null;
