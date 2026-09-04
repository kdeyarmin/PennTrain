-- The PA rule-pack templates cited the two subsections that do not state the hours.
--
-- THE FINDING. SG-2's whole premise is that a governed Pennsylvania rule pack is traceable to
-- published regulation text: `source_uri` points at pacodeandbulletin.gov, `citation` names the
-- section, and `calculation_parameters -> 'notes'` records which subsection each parameter comes
-- from. That last claim was wrong in both seeded templates, and wrong the same way.
--
--   pa.pch.2600.65.personnel said "Hour floors from 55 Pa. Code 2600.65(f)-(g)".
--   pa.alf.2800.65.personnel said "Hour floors from 55 Pa. Code 2800.65(i)-(j)".
--
-- Read against the source on 2026-09-04, neither cited subsection states an hour figure. Both are
-- lists of annual training TOPICS. The hour floors live one subsection earlier in each chapter:
--
--   2600.65(e)    "Direct care staff persons shall have at least 12 hours of annual training
--                  relating to their job duties."
--   2600.65(e)(1) "Staff person orientation shall be included in the 12 hours of training for the
--                  first year of employment."
--   2600.65(e)(2) "On the job training for direct care staff persons may count for 6 out of the 12
--                  training hours required annually."
--   2800.65(h)    "Direct care staff persons shall have at least 16 hours of annual training
--                  relating to their job duties. The training required in 2800.69 (relating to
--                  additional dementia-specific training) shall be in addition to the 16 hour
--                  annual training."
--
-- THE VALUES WERE ALL CORRECT; ONLY THE POINTERS WERE WRONG. Every parameter these templates carry
-- is confirmed by the text above -- generalAnnualHours 12 (PCH) and 16 (ALF),
-- maxOnTheJobTrainingHours 6, orientationRequired, and
-- dementiaAdditionalHoursDoNotCountTowardGeneral. So this is not a numbers correction and no
-- fixture expectation moves. It is a provenance correction, which in a governed pack is the part
-- that has to survive being checked: the first thing a surveyor or a reviewing attorney does with
-- "12 hours, per 2600.65(f)" is open (f) and not find 12 hours there.
--
-- WHY NOW, AND WHY THIS IS CHEAP. `regulatory_rule_packs` and `regulatory_rule_versions` are both
-- empty on production -- no PA pack has ever been installed. A template edit therefore rewrites
-- nothing that anyone has reviewed, approved or activated, and no installed version's
-- content_checksum_sha256 moves, because there is no installed version. The same edit after an
-- install would mean authoring a new governed version and taking it back through the gates.
--
-- source_checksum_sha256 is deliberately NOT recomputed. It hashes a claim string
-- ("...direct-care minimum 12 hours"), and that claim is exactly what was verified above, so the
-- digest still stands for something true. Its shape is a separate question, recorded in
-- BACKLOG.md rather than changed here: a column named for a source checksum that hashes a
-- hand-written label rather than the retrieved source cannot detect the regulation changing
-- underneath it, which is the one thing a source checksum is for.
--
-- ALSO FIXED, same drift class. Both descriptions still promised installation leads to
-- "fixture, independent approval, shadow, and activation gates". 20260804020000 removed the
-- mandatory shadow period from the activation gate and rewrote the install RPC's release_notes to
-- match, but not these two template rows, so the templates advertised a gate the product no
-- longer has.
--
-- BLAST RADIUS. Two rows in public.regulatory_rule_pack_templates, on a table nothing has yet
-- installed from. No function, policy, grant, or fixture changes.
--
-- Rollback: restore both rows from 20260802010000.

update public.regulatory_rule_pack_templates
set
  description = '55 Pa. Code 2600.65 personnel training for personal care homes. Installation '
    || 'creates a draft that must pass golden-fixture verification and independent approval '
    || 'before activation. Counsel-cleared product path (SG-2 option 2).',
  calculation_parameters = jsonb_set(
    calculation_parameters,
    '{notes}',
    to_jsonb(
      'Hour floors from 55 Pa. Code 2600.65(e), verified against the published section on '
      || '2026-09-04: (e) sets the 12-hour annual minimum, (e)(1) counts first-year orientation '
      || 'inside those 12 hours, and (e)(2) caps on-the-job training at 6 of the 12. Subsections '
      || '(f) and (g), which this template cited until 20260904010000, enumerate annual training '
      || 'TOPICS and state no hours. Curriculum module splits are product design, not '
      || 'regulator-issued hour allocations.'
    )
  ),
  updated_at = now()
where template_key = 'pa.pch.2600.65.personnel';

update public.regulatory_rule_pack_templates
set
  description = '55 Pa. Code 2800.65 personnel training for assisted living facilities. '
    || 'Installation creates a draft that must pass golden-fixture verification and independent '
    || 'approval before activation. Counsel-cleared product path (SG-2 option 2). Additional '
    || '2800.69 dementia hours are separate and do not count toward the 16-hour floor.',
  calculation_parameters = jsonb_set(
    calculation_parameters,
    '{notes}',
    to_jsonb(
      'Hour floors from 55 Pa. Code 2800.65(h), verified against the published section on '
      || '2026-09-04: (h) sets the 16-hour annual minimum and states in the same subsection that '
      || '2800.69 dementia-specific training is in addition to it. Subsections (i) and (j), which '
      || 'this template cited until 20260904010000, enumerate annual training TOPICS and state no '
      || 'hours. Curriculum module splits are product design, not regulator-issued hour '
      || 'allocations.'
    )
  ),
  updated_at = now()
where template_key = 'pa.alf.2800.65.personnel';

comment on table public.regulatory_rule_pack_templates is
  'Installable governed rule-pack sources. Every parameter must name the subsection that states it; 20260904010000 corrected both PA templates, which cited the topic subsections rather than the hour subsections. Editing a template is only free while nothing has installed from it -- after an install, a content change is a new governed version through the gates.';
