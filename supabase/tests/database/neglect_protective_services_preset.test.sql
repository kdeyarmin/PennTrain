-- pgTAP coverage for 20260925120800: a neglect allegation carries the immediate protective-services
-- report, because 2600.4 / 2800.4 define abuse to include neglect.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(5);

select is(
  (select due_hours || ':' || source_confidence || ':' || is_active::text
   from public.incident_notification_rules
   where incident_type = 'neglect_allegation' and notification_type = 'protective_services'),
  '2:unverified:true',
  'neglect carries the same two-hour protective-services ceiling as abuse, unverified like it'
);

select ok(
  (select citation like '%2600.4 / 2800.4%' and citation like '%2600.15(a) / 2800.15(a)%'
   from public.incident_notification_rules
   where incident_type = 'neglect_allegation' and notification_type = 'protective_services'),
  'and cites the chapters'' definition of abuse and their immediate-report section'
);

select is(
  (select citation from public.incident_notification_rules
   where incident_type = 'neglect_allegation' and notification_type = 'written_report'),
  '55 Pa. Code 2600.16(d) / 2800.16(d) (no hour count; 48 hours is an internal target)',
  'the neglect written report is unchanged'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('a2640000-0000-4000-8000-000000000001', 'Neglect Preset Org', 'neglect-preset-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('a2640000-0000-4000-8000-000000000011', 'a2640000-0000-4000-8000-000000000001', 'Neglect Preset PCH', 'PCH');

insert into public.incidents(
  id, organization_id, facility_id, incident_type, occurred_at, reported_at,
  narrative, severity, status, reportability_status
) values (
  'a2640000-0000-4000-8000-000000000401', 'a2640000-0000-4000-8000-000000000001',
  'a2640000-0000-4000-8000-000000000011', 'neglect_allegation',
  now() - interval '3 hours', now() - interval '20 minutes',
  'Resident found in a soiled bed with a new pressure injury after a missed overnight check.',
  'major', 'reported', 'reportable'
);

select is(
  (select due_at from public.incident_notifications
   where incident_id = 'a2640000-0000-4000-8000-000000000401' and notification_type = 'protective_services'),
  (select reported_at + interval '2 hours' from public.incidents where id = 'a2640000-0000-4000-8000-000000000401'),
  'a new neglect allegation is owed protective services within two hours of the facility knowing'
);

select is(
  (select string_agg(notification_type, ',' order by notification_type) from public.incident_notifications
   where incident_id = 'a2640000-0000-4000-8000-000000000401'),
  'protective_services,state_hotline,written_report',
  'alongside the Department''s 24-hour report and the written report it already had'
);

select * from finish();
rollback;
