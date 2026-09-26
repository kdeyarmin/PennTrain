-- REG38(m): retain a verifiable reference to the facility's separately protected
-- identifying-information supplement. The identifier itself is never accepted here.
alter table public.residents add column protected_identity_supplement jsonb;
create function app_private.validate_protected_identity_supplement() returns trigger language plpgsql set search_path='' as $$
declare v jsonb:=new.protected_identity_supplement;
begin
 if tg_op='UPDATE' and v is not distinct from old.protected_identity_supplement then return new; end if;
 if v is null then return new; end if;
 if jsonb_typeof(v) is distinct from 'object' or (v - array['external_reference','custodian','access_instructions','verified_at','verified_by','reason'])<>'{}'::jsonb
   or length(btrim(coalesce(v->>'external_reference','')))<3 or length(btrim(coalesce(v->>'custodian','')))<3
   or length(btrim(coalesce(v->>'access_instructions','')))<10 or length(btrim(coalesce(v->>'reason','')))<10
   or nullif(v->>'verified_at','')::timestamptz is null or (v->>'verified_at')::timestamptz>now() then
   raise exception 'Record the protected external reference, custodian, access instructions, actual verification time and reason' using errcode='23514'; end if;
 if concat_ws(' ',v->>'external_reference',v->>'custodian',v->>'access_instructions',v->>'reason') ~ '[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{4}' then
   raise exception 'Enter a record reference only; do not enter a Social Security number in supplement metadata' using errcode='23514'; end if;
 new.protected_identity_supplement:=v||jsonb_build_object('verified_by',auth.uid());
 return new;
end $$;
revoke all on function app_private.validate_protected_identity_supplement() from public,anon,authenticated;
create trigger validate_protected_identity_supplement before insert or update of protected_identity_supplement on public.residents for each row execute function app_private.validate_protected_identity_supplement();
create function public.record_protected_identity_supplement(p_resident_id uuid,p_external_reference text,p_custodian text,p_access_instructions text,p_verified_at timestamptz,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v public.residents%rowtype;
begin
 select * into v from public.residents where id=p_resident_id for update;
 if not found then raise exception 'Resident not found' using errcode='P0002'; end if;
 perform app_private.assert_resident_regulatory_manager(v.organization_id,v.facility_id);
 update public.residents set protected_identity_supplement=jsonb_build_object('external_reference',btrim(p_external_reference),'custodian',btrim(p_custodian),
   'access_instructions',btrim(p_access_instructions),'verified_at',p_verified_at,'reason',btrim(p_reason)) where id=v.id;
end $$;
revoke all on function public.record_protected_identity_supplement(uuid,text,text,text,timestamptz,text) from public,anon;
grant execute on function public.record_protected_identity_supplement(uuid,text,text,text,timestamptz,text) to authenticated,service_role;
