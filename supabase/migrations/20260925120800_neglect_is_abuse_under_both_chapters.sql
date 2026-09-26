-- A neglect allegation is owed the same immediate protective-services report as abuse.
--
-- BACKLOG.md REG9(c) / REG40. 20260925110100 added the `protective_services` preset (the report
-- 2600.15(a) / 2800.15(a) require "immediately ... in accordance with the Older Adult Protective
-- Services Act") to `abuse_allegation` and `assault` only, and left `neglect_allegation` as an open
-- question because OAPSA defines neglect separately from abuse. The chapters answer it themselves:
-- 2600.4 and 2800.4 define "Abuse" as the occurrence of one or more listed acts, and (v) is "Neglect
-- of the resident, which results in physical harm, pain or mental anguish". Both Regulatory
-- Compliance Guides repeat that list ("abuse includes: ... Neglect of the resident", 2600 RCG p.175,
-- 2800 RCG p.15) and follow it with "Upon receiving a report of abuse, [homes / residences] must:
-- 1. Immediately report suspected abuse ... in accordance with the Older Adults Protective Services
-- Act". 2800.15(a) names 6 Pa. Code 15.21-15.27 as "reporting suspected abuse, neglect,
-- abandonment or exploitation".
--
-- Two hours is the same product ceiling for "immediately" that the abuse row carries, so the row is
-- `unverified` like it. The citation is the chapters' definition rather than 6 Pa. Code 15.151,
-- which is OAPSA's own employee-report rule for its narrower definition of abuse.
--
-- Not backfilled onto neglect allegations already on file, for 20260925110100's reason: it would be
-- minted overdue on every open allegation, for a call most facilities made outside the product. New
-- incidents get it from `create_incident_notification_presets`, which reads this table. The
-- neglect written report keeps its 2600.16(d) / 2800.16(d) internal-target row.

insert into public.incident_notification_rules (
  incident_type, notification_type, due_hours, citation, source_confidence, note
) values (
  'neglect_allegation', 'protective_services', 2,
  '55 Pa. Code 2600.4 / 2800.4 ("Abuse" (v), neglect); 2600.15(a) / 2800.15(a)', 'unverified',
  'Both chapters define abuse to include "Neglect of the resident, which results in physical harm, '
    || 'pain or mental anguish" (2600.4 / 2800.4), and 2600.15(a) / 2800.15(a) require suspected '
    || 'abuse to be reported "immediately" under the Older Adult Protective Services Act -- the oral '
    || 'report to the protective services agency (the area agency on aging). The regulation says '
    || '"immediately"; two hours is this product''s ceiling for it.'
)
on conflict (incident_type, notification_type) do nothing;
