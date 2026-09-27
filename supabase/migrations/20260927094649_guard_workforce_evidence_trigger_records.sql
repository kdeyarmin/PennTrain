-- Dispositions share this trigger but have no evidence column. Dispatch before
-- accessing the lifecycle-event row; SQL AND terms do not guard record binding.
create or replace function app_private.prevent_immutable_workforce_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'employment_lifecycle_events' then
    if tg_op = 'DELETE' then
      if current_setting('app.allow_employee_import_rollback', true) = 'on'
         and coalesce(old.evidence ->> 'source', '') = 'employee_insert' then
        return old;
      end if;
    end if;
  end if;

  raise exception 'employment lifecycle evidence is append-only'
    using errcode = '55000';
end;
$$;

-- CREATE OR REPLACE preserves the owner, private EXECUTE ACL and trigger scope.
