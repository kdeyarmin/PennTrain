-- Recovered verbatim from production supabase_migrations.schema_migrations.statements
-- (applied 2026-07-24 as version 20260724051549 but never committed to git).
-- See PennTrain_Comprehensive_Review_2026-07-24.md addendum / PT-051.
--
-- Update placeholder citation_note/required_roles_text for all three
-- previously-empty training types now that real courses back them.
do $update_training_types$
declare
  v_updated integer;
begin

  update public.training_types
  set citation_note = $txt$55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1): annual fire safety and emergency preparedness training, covering fire prevention, initial response, and evacuating residents who need assistance, refreshed every 12 months for direct-contact staff.$txt$
    , required_roles_text = $txt$All direct-contact staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF), annually.$txt$
  where organization_id is null and code = 'FIRE-SAFETY';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one system % training type, updated %', 'FIRE-SAFETY', v_updated;
  end if;

  update public.training_types
  set citation_note = $txt$55 Pa. Code Sections 2600.65(g)(4) and 2800.65(j)(4): annual mandatory reporter training on Pennsylvania's Older Adult Protective Services Act (OAPSA), covering legal definitions, the reporting process, reporter protections, and financial exploitation red flags.$txt$
    , required_roles_text = $txt$All direct-contact staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF), annually, as mandatory reporters under OAPSA.$txt$
  where organization_id is null and code = 'ABUSE-REPORT';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one system % training type, updated %', 'ABUSE-REPORT', v_updated;
  end if;

  update public.training_types
  set citation_note = $txt$55 Pa. Code Sections 2600.65(g)(3) and 2800.65(j)(3): annual resident rights and dignity training, covering person-centered care, financial and communication rights, the grievance process, and when a right may be narrowly limited for documented safety reasons.$txt$
    , required_roles_text = $txt$All direct-contact staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF), annually.$txt$
  where organization_id is null and code = 'RESIDENT-RIGHTS';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one system % training type, updated %', 'RESIDENT-RIGHTS', v_updated;
  end if;

end;
$update_training_types$;
