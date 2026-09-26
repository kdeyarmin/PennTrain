-- Presentation-only lookup for the already-authorized invitation handler.
-- Service execution does not create users, grant access or impersonate an actor.
create function public.get_training_invitation_branding(p_organization_id uuid,p_facility_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'logo_path',case when split_part(s.branding_logo_path,'/',1)=o.id::text
      and length(s.branding_logo_path) between 1 and 1024
      and cardinality(string_to_array(s.branding_logo_path,'/'))>=2
      and strpos(s.branding_logo_path,chr(92))=0
      and s.branding_logo_path !~ '[%?#[:cntrl:] ]'
      and not exists(select 1 from unnest(string_to_array(s.branding_logo_path,'/')) segment where segment in ('','.','..'))
      then s.branding_logo_path else null end,
    'contact_name',w.contact_name,'contact_email',w.contact_email)
  from public.organizations o
  left join public.organization_settings s on s.organization_id=o.id
  left join public.facilities f on f.id=p_facility_id and f.organization_id=o.id and f.is_active
  left join app_private.training_facility_welcome w on w.facility_id=f.id and w.organization_id=o.id
  where o.id=p_organization_id and o.subscription_status not in ('suspended','canceled')
    and (p_facility_id is null or f.id is not null)
    and exists(select 1 from public.get_effective_entitlements(o.id) e where e.feature_key='modules.train' and e.is_entitled);
$$;
revoke all on function public.get_training_invitation_branding(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_training_invitation_branding(uuid,uuid) to service_role;
