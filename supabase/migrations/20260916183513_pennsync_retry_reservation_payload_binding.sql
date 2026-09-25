do $$
declare definition text;
begin
 definition := pg_get_functiondef('public.cm_integration_reserve(text,text,text,text,text,uuid,integer)'::regprocedure);
 if position('values(p_app_id,p_subject,p_operation,p_request_id,payload_hash,p_claim' in definition)=0 then raise exception 'Expected unambiguous reservation repair location was not found';end if;
 definition:=replace(definition,'values(p_app_id,p_subject,p_operation,p_request_id,payload_hash,p_claim','values(p_app_id,p_subject,p_operation,p_request_id,p_payload_hash,p_claim');
 execute definition;
end $$;