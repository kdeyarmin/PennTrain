-- A still-pending attestation whose policy version was replaced cannot be signed.
-- BACKLOG J7 said that row stops counting as outstanding. The command center,
-- platform health, and the governed-learning tile still counted it, so a closed
-- campaign kept a facility in attention and inflated the platform pending tile.
-- A pending row with no superseded_at is unchanged.

do $cl28do$
declare
  body text;
begin
  select pg_get_functiondef('public.get_operations_command_center(uuid)'::regprocedure) into body;
  if body is null then
    raise exception 'public.get_operations_command_center is missing';
  end if;
  if position('p.superseded_at is null and p.due_date < public.pa_today()' in body) > 0 then
    raise notice 'command center already skips superseded policy attestations';
  else
    if position(
      'where p.status = ''pending'' and p.due_date < public.pa_today()) as overdue_policy_attestations'
      in body
    ) = 0 then
      raise exception 'command center policy-attestation count changed';
    end if;
    body := replace(
      body,
      'where p.status = ''pending'' and p.due_date < public.pa_today()) as overdue_policy_attestations',
      'where p.status = ''pending'' and p.superseded_at is null and p.due_date < public.pa_today()) as overdue_policy_attestations'
    );
    execute body;
  end if;

  select pg_get_functiondef('public.get_platform_health()'::regprocedure) into body;
  if body is null then
    raise exception 'public.get_platform_health is missing';
  end if;
  if position('where status = ''pending'' and superseded_at is null' in body) > 0 then
    raise notice 'platform health already skips superseded policy attestations';
  else
    if position($cl28$    'pendingPolicyAttestations', (
      select count(*) from public.policy_attestations where status = 'pending'
    ),
    'overduePolicyAttestations', (
      select count(*) from public.policy_attestations
      where status = 'pending'
        and due_date is not null
        and due_date < v_today
    ),$cl28$ in body) = 0 then
      raise exception 'platform health policy-attestation counts changed';
    end if;
    body := replace(body, $cl28$    'pendingPolicyAttestations', (
      select count(*) from public.policy_attestations where status = 'pending'
    ),
    'overduePolicyAttestations', (
      select count(*) from public.policy_attestations
      where status = 'pending'
        and due_date is not null
        and due_date < v_today
    ),$cl28$, $cl28$    'pendingPolicyAttestations', (
      select count(*) from public.policy_attestations
      where status = 'pending' and superseded_at is null
    ),
    'overduePolicyAttestations', (
      select count(*) from public.policy_attestations
      where status = 'pending'
        and superseded_at is null
        and due_date is not null
        and due_date < v_today
    ),$cl28$);
    execute body;
  end if;

  select pg_get_functiondef('public.get_governed_learning_control_plane()'::regprocedure) into body;
  if body is null then
    raise exception 'public.get_governed_learning_control_plane is missing';
  end if;
  if position(
    '''pendingAttestations'',(select count(*) from public.policy_attestations where status=''pending'' and superseded_at is null)'
    in body
  ) > 0 then
    raise notice 'governed learning already skips superseded policy attestations';
  else
    if position(
      '''pendingAttestations'',(select count(*) from public.policy_attestations where status=''pending'')'
      in body
    ) = 0 then
      raise exception 'governed learning pending-attestation count changed';
    end if;
    execute replace(
      body,
      '''pendingAttestations'',(select count(*) from public.policy_attestations where status=''pending'')',
      '''pendingAttestations'',(select count(*) from public.policy_attestations where status=''pending'' and superseded_at is null)'
    );
  end if;
end;
$cl28do$;
