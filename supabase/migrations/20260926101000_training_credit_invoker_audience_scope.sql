-- Keep the annual-credit read model an invoker. The internal audience helper is
-- deliberately ungranted; repeat its latest-decision lookup against the same
-- RLS-protected training records instead of elevating the whole calculation.
do $$ declare body text; marker text; begin
 select pg_get_functiondef('public.staff_training_credit_allocation(uuid,text,date,date,jsonb,jsonb,numeric)'::regprocedure) into body;
 marker:='public.current_training_audience_status(r.employee_id,tt.id)';
 if position(marker in body)=0 then raise exception 'Training record audience marker changed'; end if;
 body:=replace(body,marker,'(select ar.status from public.employee_training_records ar where ar.employee_id=r.employee_id and ar.training_type_id=tt.id order by ar.audience_decision_at desc nulls last,ar.created_at desc,ar.id desc limit 1)');
 marker:='public.current_training_audience_status(cc.employee_id,tt.id)';
 if position(marker in body)=0 then raise exception 'Course credit audience marker changed'; end if;
 body:=replace(body,marker,'(select ar.status from public.employee_training_records ar where ar.employee_id=cc.employee_id and ar.training_type_id=tt.id order by ar.audience_decision_at desc nulls last,ar.created_at desc,ar.id desc limit 1)');
 execute body;
end $$;
