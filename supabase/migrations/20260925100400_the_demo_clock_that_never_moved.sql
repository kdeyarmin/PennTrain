-- app_private.seed_demo_organization stamps organizations.demo_reset_at = now() when it finishes,
-- and protect_organization_subscription_fields (extended by 20260906060000 / BACKLOG J76) copies
-- demo_reset_at and demo_seed_version back from OLD for any writer that is neither a platform admin
-- nor running with app.privileged_write set. None of the function's callers is either:
-- restore_demo_baseline() runs as the demo tenant's org_admin, restore_all_demo_baselines() runs
-- from cron with no JWT, and seed.sql runs as postgres. So the reseed reported success and the
-- "Last restored" clock on Settings never moved ("Starter data has not been restored yet." forever).
-- seed.sql documents this trap for its own is_demo UPDATE; the function's internal write was never
-- wrapped. Patched onto the LIVE body (pg_get_functiondef + guarded replace) because the deployed
-- definition was re-declared by 20260727010100 after 20260717163659 wrote it. The prior GUC value is
-- kept in a sibling setting and restored afterwards, so a caller that already elevated (seed.sql's
-- own DO block, a trusted RPC) is not switched off underneath.
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('app_private.seed_demo_organization(uuid)'::regprocedure);
  v_old := $q$  update public.organizations
  set demo_seed_version = 1, demo_reset_at = now(), updated_at = now()
  where id = v_org.id;$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'seed_demo_organization no longer stamps demo_reset_at in the shape this migration patches';
  end if;
  v_new := $q$  -- protect_organization_subscription_fields (BACKLOG J76) reverts demo_seed_version and
  -- demo_reset_at for any writer that is not a platform admin; this definer is the trusted writer
  -- of the demo clock, so the write goes through the same escape hatch the other trusted RPCs use,
  -- restoring whatever the caller had set afterwards.
  perform set_config('app.privileged_write_prior', coalesce(current_setting('app.privileged_write', true), ''), true);
  perform set_config('app.privileged_write', 'on', true);
  update public.organizations
  set demo_seed_version = 1, demo_reset_at = now(), updated_at = now()
  where id = v_org.id;
  perform set_config('app.privileged_write', coalesce(current_setting('app.privileged_write_prior', true), ''), true);$q$;
  execute replace(v_def, v_old, v_new);
end
$do$;
