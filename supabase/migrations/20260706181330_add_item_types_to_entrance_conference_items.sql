-- Forward-fix (review finding): InspectionReadiness.tsx's Mock Entrance Conference Checklist
-- computes every `data_source: 'inspections'` prompt's readiness from the ENTIRE inspection_items
-- table, with no filter by item_type -- so the four distinct checklist prompts tagged 'inspections'
-- (fire drills, extinguisher/alarm/detector inspections, emergency-prep-plan review, 3-day supply
-- check) all show the identical aggregate verdict regardless of which specific item is actually
-- overdue. A facility with an overdue generator inspection but current drills/extinguishers/
-- emergency-prep-plan would show all four rows as "Attention Needed" identically, misdirecting an
-- administrator prepping for a survey toward the wrong deficiency.
--
-- This migration only adds the schema hook the frontend needs to fix that (a nullable
-- item_types array so a checklist row can name exactly which inspection_items.item_type value(s)
-- it's actually asking about, instead of aggregating the whole table) and backfills it for the
-- rows where a clean, unambiguous mapping exists. A null item_types means "not yet scoped" -- the
-- frontend should keep today's whole-table aggregate behavior for those rows rather than silently
-- matching zero items.
--
-- "3-day emergency supply check current" is deliberately left unscoped: inspection_items.item_type
-- has no distinct value for an emergency-supply check today (its check constraint only allows
-- 'generator','fire_extinguisher','fire_alarm_system','sprinkler_system','smoke_detector',
-- 'emergency_lighting','elevator','other_equipment','fire_drill_program',
-- 'emergency_prep_plan_review','other_procedural') -- adding a distinct inspection item type for it
-- is a separate, deliberate product decision, not something this forward-fix should invent.
alter table public.entrance_conference_items add column item_types text[];

update public.entrance_conference_items
set item_types = array['fire_drill_program']
where data_source = 'inspections' and prompt = 'Fire drills conducted and logged at the required frequency, including a sleeping-hours drill';

update public.entrance_conference_items
set item_types = array['fire_extinguisher','fire_alarm_system','smoke_detector']
where data_source = 'inspections' and prompt = 'Fire extinguishers, alarm systems, and smoke detectors inspected on schedule';

update public.entrance_conference_items
set item_types = array['emergency_prep_plan_review']
where data_source = 'inspections' and prompt = 'Emergency preparedness plan reviewed within the required interval';
