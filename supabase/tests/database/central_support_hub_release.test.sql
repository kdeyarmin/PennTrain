begin;
select plan(3);

select results_eq(
  $$ select value_type, default_value, is_active
     from public.feature_definitions where feature_key = 'support.central_hub' $$,
  $$ values ('boolean'::text, 'false'::jsonb, true) $$,
  'central support has a typed default-off feature definition'
);

select results_eq(
  $$ select rollout_mode, is_enabled, owner, expires_at is null,
            changelog_title is null, changelog_summary is null, help_path is null,
            released_at is null
     from public.release_flags where feature_key = 'support.central_hub' $$,
  $$ values ('off'::text, false, 'support'::text, true, true, true, true, true) $$,
  'central support is registered dark without customer-facing release notes'
);

select is(
  app_private.is_feature_release_active(null, 'support.central_hub'),
  false,
  'the central support release gate fails closed before rollout'
);

select * from finish();
rollback;
