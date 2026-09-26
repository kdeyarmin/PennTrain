-- The mixed obligations table now contains clinical evidence. Its immutable audit
-- snapshots must not become a second, unlogged clinical-reader API. Preserve those
-- snapshots unchanged; ordinary audit readers use the existing logged resident
-- duty reader for clinical content. Financial/notice audit rows stay visible.
create function app_private.is_resident_clinical_duty_action(p_action_type text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_action_type=any(array['scu_admission','scu_support_plan','scu_continuing_need','scu_plan_review','resident_tb_test','medication_refusal_notice','alf_exception_request']),false);
$$;
revoke all on function app_private.is_resident_clinical_duty_action(text) from public,anon,authenticated,service_role;
grant execute on function app_private.is_resident_clinical_duty_action(text) to authenticated,service_role;
create policy resident_clinical_duty_audit_reader on public.audit_logs as restrictive for select to authenticated
 using(entity_type<>'resident_regulatory_actions' or (
   not app_private.is_resident_clinical_duty_action(new_values->>'action_type')
   and not app_private.is_resident_clinical_duty_action(old_values->>'action_type')));

-- The trusted export worker bypasses RLS. Apply the resident's disclosure decision
-- to these clinical rows AND their audit copies, through the existing shared
-- predicate so the archive's withholding counts use exactly the same rule.
do $patch$
declare v_definition text; v_anchor text:='  select case';
begin
 select pg_get_functiondef('app_private.export_consent_predicate(text)'::regprocedure) into v_definition;
 if position(v_anchor in v_definition)=0 then raise exception 'Export consent predicate no longer has the expected CASE'; end if;
 execute replace(v_definition,v_anchor,$replacement$  select case
    when p_table_name='resident_regulatory_actions' then $sql$
      and (not app_private.is_resident_clinical_duty_action(t.action_type) or exists (
        select 1 from public.residents r where r.id=t.resident_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)))
    $sql$
    when p_table_name='audit_logs' then $sql$
      and (t.entity_type<>'resident_regulatory_actions' or (
        (not app_private.is_resident_clinical_duty_action(t.new_values->>'action_type') or exists (
          select 1 from public.residents r where r.id::text=t.new_values->>'resident_id'
            and app_private.clinical_disclosure_allowed(r.clinical_data_consent)))
        and (not app_private.is_resident_clinical_duty_action(t.old_values->>'action_type') or exists (
          select 1 from public.residents r where r.id::text=t.old_values->>'resident_id'
            and app_private.clinical_disclosure_allowed(r.clinical_data_consent)))))
    $sql$ $replacement$);
end $patch$;
