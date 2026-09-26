-- Missing employment dates are unknown evidence, not proof of a partial year.
do $$ declare body text; marker text; begin
 select pg_get_functiondef('public.staff_training_period(uuid,date,boolean)'::regprocedure) into body;
 marker:='''partialFirstYear'',hired is null or hired>starts';
 if position(marker in body)=0 then raise exception 'Training-period hire evidence marker changed'; end if;
 execute replace(body,marker,'''hireDateMissing'',hired is null,''partialFirstYear'',hired is not null and hired>starts');
 select pg_get_functiondef('app_private.refresh_staff_training_policy(uuid)'::regprocedure) into body;
 marker:='when (period->>''partialFirstYear'')::boolean then ''compliant''';
 if position(marker in body)=0 then raise exception 'Annual bucket partial-year marker changed'; end if;
 execute replace(body,marker,'when period->>''hireDate'' is null or period->>''start'' is null then ''incomplete'' '||marker);
end $$;

-- Enabling the optional TB policy reuses dated evidence immediately. Turning the
-- policy off preserves the evidence and makes only its requirement inapplicable.
do $$ declare body text; marker text; begin
 select pg_get_functiondef('app_private.apply_staff_credential_policy()'::regprocedure) into body;
 marker:=$old$elsif new.credential_type='tb_screening' and not coalesce(p.staff_tb_required,false) then
  new.status:='not_applicable';$old$;
 if position(marker in body)=0 then raise exception 'Optional TB credential marker changed'; end if;
 execute replace(body,marker,$new$elsif new.credential_type='tb_screening' then
  new.status:=case when not coalesce(p.staff_tb_required,false) then 'not_applicable'
   when new.issue_date is null or new.issue_date>public.pa_today() then 'missing'
   when new.expiration_date<public.pa_today() then 'expired'
   when new.expiration_date<=public.pa_today()+new.warning_days then 'due_soon' else 'compliant' end;$new$);
end $$;
select public.recalculate_compliance_core(null);
