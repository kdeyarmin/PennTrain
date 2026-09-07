-- A governed rule the crosswalk could never find.
--
-- BACKLOG J56 (the binding half).
--
-- `governedRuleForObligation` matches an active rule version to a crosswalk obligation on
-- `applicability->>'crosswalkObligationId'`. Nothing writes that key. The three seeded rule-pack
-- templates carry `stateCodes`, `workerTypes` and `facilityTypes` and nothing else, and
-- `install_regulatory_rule_pack_template` copies the template's applicability verbatim into the
-- version it creates -- so however many packs an organization installs and activates, every
-- crosswalk row stays a reference mapping with no governed citation behind it, and the
-- surveyor-facing export says "not governed" for rules that are.
--
-- All three templates are PERSONNEL packs: 55 Pa. Code 2600.65 / 2800.65 and Ohio's 3701-16
-- personnel rule are the staff orientation, annual training and competency requirements, which is
-- exactly the crosswalk's `staff-training` obligation. The key goes on the template, so every
-- future install carries it, and on any version already installed from one of them.

update public.regulatory_rule_pack_templates
set applicability = applicability || jsonb_build_object('crosswalkObligationId', 'staff-training')
where template_key in (
  'pa.pch.2600.65.personnel',
  'pa.alf.2800.65.personnel',
  'oh.rcf.3701-16.personnel'
)
  and coalesce(applicability->>'crosswalkObligationId', '') <> 'staff-training';

-- Versions already installed from those templates predate the key; they describe the same rule.
update public.regulatory_rule_versions v
set applicability = v.applicability || jsonb_build_object('crosswalkObligationId', 'staff-training')
from public.regulatory_rule_packs p
where p.id = v.rule_pack_id
  -- install_regulatory_rule_pack_template uses the TEMPLATE KEY as the pack's rule_key.
  and p.rule_key in (
    'pa.pch.2600.65.personnel', 'pa.alf.2800.65.personnel', 'oh.rcf.3701-16.personnel'
  )
  and coalesce(v.applicability->>'crosswalkObligationId', '') <> 'staff-training';

comment on column public.regulatory_rule_pack_templates.applicability is
  'What this rule pack applies to: stateCodes, facilityTypes, workerTypes, and '
  '`crosswalkObligationId` -- the id of the REGULATORY_OBLIGATIONS row on the crosswalk this pack '
  'governs. install_regulatory_rule_pack_template copies this verbatim onto the version it '
  'creates, and the crosswalk reads it to decide whether a row is governed by an approved rule or '
  'is still a reference mapping. Nothing wrote the key before BACKLOG J56, so no row could ever '
  'read as governed.';
