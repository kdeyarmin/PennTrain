-- PT-065: requalify the standalone training types' citation notes so they never
-- read as if 55 Pa. Code issues a per-topic hour split. The regulation requires
-- each subject annually *within* the overall annual training hours (12 hours PCH
-- under 2600.65(f)-(g) / 16 hours ALF under 2800.65(i)-(j)); the dedicated
-- 1.00-hour allocation on these types is PennTrain curriculum design, matching
-- the disclaimer PA_DHS_ANNUAL_TRAINING_MATRIX.md has always carried. Keeps the
-- real citations from 20260724051549 and appends the qualifier; same
-- update-exactly-one assertion pattern as that migration.
do $update_training_types$
declare
  v_updated integer;
begin

  update public.training_types
  set citation_note = $txt$55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1): annual fire safety and emergency preparedness training, covering fire prevention, initial response, and evacuating residents who need assistance, refreshed every 12 months for direct-contact staff. The regulation requires this subject annually within the overall annual training hours (12 hours PCH / 16 hours ALF); the dedicated 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split.$txt$
  where organization_id is null and code = 'FIRE-SAFETY';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one system % training type, updated %', 'FIRE-SAFETY', v_updated;
  end if;

  update public.training_types
  set citation_note = $txt$55 Pa. Code Sections 2600.65(g)(4) and 2800.65(j)(4): annual mandatory reporter training on Pennsylvania's Older Adult Protective Services Act (OAPSA), covering legal definitions, the reporting process, reporter protections, and financial exploitation red flags. The regulation requires this subject annually within the overall annual training hours (12 hours PCH / 16 hours ALF); the dedicated 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split.$txt$
  where organization_id is null and code = 'ABUSE-REPORT';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one system % training type, updated %', 'ABUSE-REPORT', v_updated;
  end if;

  update public.training_types
  set citation_note = $txt$55 Pa. Code Sections 2600.65(g)(3) and 2800.65(j)(3): annual resident rights and dignity training, covering person-centered care, financial and communication rights, the grievance process, and when a right may be narrowly limited for documented safety reasons. The regulation requires this subject annually within the overall annual training hours (12 hours PCH / 16 hours ALF); the dedicated 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split.$txt$
  where organization_id is null and code = 'RESIDENT-RIGHTS';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one system % training type, updated %', 'RESIDENT-RIGHTS', v_updated;
  end if;

end;
$update_training_types$;
