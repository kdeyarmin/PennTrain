-- C5 foundation: order entrance-conference checklist / packet by regulation reference.
-- Adds regulation_ref so Survey Day and Inspection Readiness can walk items in DHS
-- citation order rather than arbitrary category/sort_order alone.

alter table public.entrance_conference_items
  add column if not exists regulation_ref text;

comment on column public.entrance_conference_items.regulation_ref is
  'Optional PA regulation citation (e.g. §2600.65) used to order entrance-conference packets.';

create index if not exists entrance_conference_items_regulation_ref_idx
  on public.entrance_conference_items (regulation_ref nulls last, sort_order);

-- Best-effort backfill from known prompt wording (idempotent; only fills nulls).
update public.entrance_conference_items
set regulation_ref = '§2600.65 / §2800.65'
where regulation_ref is null
  and prompt ~* 'training|in-service|annual hours|staff development';

update public.entrance_conference_items
set regulation_ref = '§2600.57 / §2800.57'
where regulation_ref is null
  and prompt ~* 'criminal history|background check|clearance';

update public.entrance_conference_items
set regulation_ref = '§2600.54 / §2800.54'
where regulation_ref is null
  and prompt ~* 'staffing|direct care ratio|awake staff';

update public.entrance_conference_items
set regulation_ref = '§2600.130 / §2800.130'
where regulation_ref is null
  and prompt ~* 'fire drill|sleeping-hours drill';

update public.entrance_conference_items
set regulation_ref = '§2600.132 / §2800.132'
where regulation_ref is null
  and prompt ~* 'extinguisher|smoke detector|alarm system';

update public.entrance_conference_items
set regulation_ref = '§2600.133 / §2800.133'
where regulation_ref is null
  and prompt ~* 'emergency preparedness|emergency plan';

update public.entrance_conference_items
set regulation_ref = '§2600.141 / §2800.141'
where regulation_ref is null
  and prompt ~* 'medication|med admin';

update public.entrance_conference_items
set regulation_ref = '§2600.42 / §2800.42'
where regulation_ref is null
  and prompt ~* 'resident rights';

update public.entrance_conference_items
set regulation_ref = '§2600.25 / §2800.25'
where regulation_ref is null
  and prompt ~* 'administrator|operator qualification';
