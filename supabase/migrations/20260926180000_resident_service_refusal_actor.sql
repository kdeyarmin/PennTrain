-- Integration imports have a service principal, not necessarily a staff profile.
-- Retain the immutable imported event as the source; never invent a human creator
-- or reject valid medication evidence because the service JWT has an unmapped sub.
do $patch$
declare v_definition text; v_old text:='new.created_by:=case when tg_op=''INSERT'' then auth.uid() else old.created_by end;';
begin
 select pg_get_functiondef('app_private.prepare_resident_clinical_duty()'::regprocedure) into v_definition;
 if position(v_old in v_definition)=0 then raise exception 'Clinical creator assignment no longer matches the expected definition'; end if;
 execute replace(v_definition,v_old,'new.created_by:=case when tg_op=''INSERT'' then (select id from public.profiles where id=auth.uid()) else old.created_by end;');
end $patch$;
