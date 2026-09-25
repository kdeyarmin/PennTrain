-- Reportable-incident windows, read against the text they cite.
--
-- 20260905080000 moved the notification windows into incident_notification_rules and left the
-- question it could not answer in the data: four rows gave the Department two hours, "which
-- matches 42 CFR 483.12(c), which governs NURSING facilities", while "this repository's own reading
-- of the Pennsylvania sections is 24 hours". 20260906270000 added a 48-hour written report on the
-- same footing. Both were marked `unverified` until somebody read the regulation. This migration is
-- that reading, from the text as published on pacodeandbulletin.gov (55 Pa. Code through
-- 56 Pa.B. 4026; 6 Pa. Code Chapter 15).
--
--   * THE DEPARTMENT: 24 HOURS, FOR EVERY TYPE. 2600.16(c): "The home shall report the incident or
--     condition to the Department's personal care home regional office or the personal care home
--     complaint hotline within 24 hours." 2800.16(c) says the same for an assisted living
--     residence. There is no shorter window for a death, an abuse allegation or an assault in
--     either chapter. Two hours was the nursing-facility rule, and it made every PCH and ALF
--     facility read as late on a deadline Pennsylvania does not impose.
--
--   * "IMMEDIATELY" IS OAPSA, AND IT GOES TO PROTECTIVE SERVICES, NOT THE DEPARTMENT. 2600.15(a) /
--     2800.15(a) require suspected abuse to be reported "immediately ... in accordance with the
--     Older Adult Protective Services Act", and 6 Pa. Code 15.151(a) says what that means: an oral
--     report to the protective services agency (the area agency on aging) immediately, and a
--     written report to it within 48 hours. That call had no notification at all; it is added as
--     `protective_services`. 15.152(a) adds an immediate oral report to law enforcement for sexual
--     abuse, serious physical or bodily injury, or a suspicious death, and a written report to law
--     enforcement and the agency within 48 hours -- which is where the existing law_enforcement rows
--     and the 48-hour written report actually come from.
--
--   * TWO HOURS STAYS WHERE THE LAW SAYS "IMMEDIATELY". The regulation gives no number, so the
--     protective-services and law-enforcement rows keep two hours as this product's ceiling for
--     "immediately" and stay `unverified`: the citation is now right, the number is still a choice.
--
--   * THE DEPARTMENT'S FINAL REPORT HAS NO HOUR COUNT. 2600.16(d) / 2800.16(d): "immediately
--     following the conclusion of the investigation". For incident types that are not OAPSA abuse,
--     48 hours is an internal target and the row now says so.
--
-- Not changed: a family / designated-person notification. 2800.16(c) requires an ALF to notify the
-- family and designated person "immediately" for every reportable incident; Chapter 2600 requires
-- it only for suspected abuse or neglect (2600.15(d)). This table has no facility-type column, so a
-- preset here would apply to both chapters. Recorded on BACKLOG.md for a decision.

alter table public.incident_notifications
  drop constraint if exists incident_notifications_notification_type_check;
alter table public.incident_notifications
  add constraint incident_notifications_notification_type_check
  check (notification_type in (
    'state_hotline', 'family_guardian', 'law_enforcement', 'licensing_agency',
    'protective_services', 'written_report', 'other'));

comment on constraint incident_notifications_notification_type_check on public.incident_notifications is
  'state_hotline / licensing_agency are the Department report (24 hours, 2600.16(c) / 2800.16(c)); '
  'protective_services is the OAPSA report to the area agency on aging (immediately, 6 Pa. Code '
  '15.151); written_report is the written report that follows; family_guardian and law_enforcement '
  'are the other required contacts; other is a facility-added one.';

update public.incident_notification_rules
set due_hours = 24,
    citation = '55 Pa. Code 2600.16(c) / 2800.16(c)',
    source_confidence = 'verified',
    note = 'Both chapters: report to the Department''s regional office or complaint hotline "within 24 '
      || 'hours in a manner designated by the Department". Read against the text by 20260925110100; '
      || 'the two-hour window some rows carried before it was the nursing-facility rule (42 CFR '
      || '483.12(c)), which does not apply to personal care homes or assisted living facilities.'
where notification_type = 'state_hotline';

update public.incident_notification_rules
set citation = '6 Pa. Code 15.152(a)(1); 55 Pa. Code 2600.15(a) / 2800.15(a)',
    source_confidence = 'unverified',
    note = 'OAPSA: an immediate oral report to law enforcement when a resident is suspected to be the '
      || 'victim of sexual abuse, serious physical or bodily injury, or a suspicious death. The '
      || 'regulation says "immediately"; two hours is this product''s ceiling for it, not a '
      || 'regulatory number.'
where notification_type = 'law_enforcement'
  and incident_type in ('abuse_allegation', 'assault');

insert into public.incident_notification_rules (
  incident_type, notification_type, due_hours, citation, source_confidence, note
)
select t.incident_type, 'protective_services', 2,
  '6 Pa. Code 15.151(a)(1); 55 Pa. Code 2600.15(a) / 2800.15(a)', 'unverified',
  'OAPSA: an administrator or employee with reasonable cause to suspect a resident is a victim of '
    || 'abuse shall immediately make an oral report to the protective services agency (the area '
    || 'agency on aging). The regulation says "immediately"; two hours is this product''s ceiling for '
    || 'it. For an assault this applies when a resident is the victim.'
from (values ('abuse_allegation'), ('assault')) as t(incident_type)
on conflict (incident_type, notification_type) do nothing;

update public.incident_notification_rules
set citation = '6 Pa. Code 15.151(a)(2) / 15.152(a)(3); 55 Pa. Code 2600.16(d) / 2800.16(d)',
    source_confidence = 'verified',
    note = 'OAPSA: a written report to the protective services agency within 48 hours of the oral '
      || 'report, and to law enforcement as well where 15.152 applies. The Department''s own final '
      || 'report (2600.16(d) / 2800.16(d)) follows the conclusion of the investigation.'
where notification_type = 'written_report'
  and incident_type in ('abuse_allegation', 'assault');

update public.incident_notification_rules
set citation = '55 Pa. Code 2600.16(d) / 2800.16(d) (no hour count; 48 hours is an internal target)',
    source_confidence = 'unverified',
    note = 'The Department''s final report is due "immediately following the conclusion of the '
      || 'investigation" -- the regulation gives no number of hours. 48 hours is this product''s '
      || 'target for having it written, so the duty carries a date rather than existing only in '
      || 'someone''s memory.'
where notification_type = 'written_report'
  and incident_type not in ('abuse_allegation', 'assault');

-- Department notifications already open under the two-hour window move to 24 hours. Only rows the
-- presets created -- due exactly two hours after one of the anchors create_incident_notification
-- _presets has used -- so a deadline somebody typed by hand is left alone. A completed or
-- stood-down notification is a record and is not touched.
update public.incident_notifications n
set due_at = n.due_at + interval '22 hours',
    updated_at = now()
from public.incidents i
where i.id = n.incident_id
  and n.notification_type = 'state_hotline'
  and n.completed_at is null
  and n.status in ('pending', 'overdue')
  and i.incident_type in ('death', 'abuse_allegation', 'neglect_allegation', 'assault')
  and n.due_at in (
    i.occurred_at + interval '2 hours',
    i.reported_at + interval '2 hours',
    i.reportability_determined_at + interval '2 hours'
  );

-- Clears the critical overdue alerts the two-hour window raised on notifications that are still
-- inside 24 hours. The protective-services row is not backfilled onto incidents already on file:
-- it would be minted overdue on every open abuse allegation, for a call most facilities made
-- outside the product, and a deadline nobody could have met is the false record 20260905080000
-- exists to prevent. New incidents get it from the presets.
do $$
begin
  perform set_config('app.privileged_write', 'on', true);
  perform public.recalculate_incident_notifications();
  perform set_config('app.privileged_write', 'off', true);
end;
$$;
