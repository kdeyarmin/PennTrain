-- The training record that was replaced and kept complaining, the seat clock that started when the
-- learner reconnected, the assignment a manager cancelled that the player kept taking work for,
-- the trainer dashboard that thought a draft was today's class, the transcript that printed CE
-- hours nobody accredited, the announcement its own author could not see, and a job aide hidden by
-- a typo.
--
-- BACKLOG.md J74 -- the Train and Policy/regulatory/help paragraphs of RELEASE_READINESS_PLAN.md
-- section 4.3.
--
-- Every change here is a patch against the LIVE function body via pg_get_functiondef(), anchored on
-- the exact text it replaces and raising if that text is gone, so none of it can silently revert a
-- fix somebody else made to the same function.

-- ---------------------------------------------------------------------------
-- B1 -- a superseded training record is not an outstanding obligation
-- ---------------------------------------------------------------------------
--
-- A renewal INSERTS a fresh employee_training_records row; the previous cycle's row is left alone
-- and the nightly pass keeps grading it by its own completion_date, so it reads 'expired' forever
-- (this is deliberate -- it is the evidence of last year's training). recalculate_compliance_core
-- then opened an 'overdue' alert for EVERY due_soon/expired row, notify_training_alert turned each
-- one into a `training_expired` notification, and resolve_stale_compliance_alerts closed it again
-- afterwards. So the loop ran every night: insert, notify, resolve, insert, notify, resolve. An
-- employee who renewed a requirement on time was told it had expired, monthly, indefinitely.
--
-- The alert is about the requirement, and the requirement's state is the CURRENT record for that
-- (employee, training type) -- latest due_date, then completion_date, then created_at, which is the
-- ordering the matrix, the dashboard RPC and src/lib/currentTrainingRecords.ts all already use.

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.recalculate_compliance_core(uuid)'::regprocedure);

  if position('superseded' in v_def) > 0 then
    raise notice 'recalculate_compliance_core already skips superseded training records';
  else
    v_old := $q$    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    join public.employees e on e.id = r.employee_id
    where r.status in ('due_soon','expired')
      and (p_organization_id is null or r.organization_id = p_organization_id)
  ),$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'recalculate_compliance_core no longer selects the alertable training records this migration patches';
    end if;
    v_new := $q$    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    join public.employees e on e.id = r.employee_id
    where r.status in ('due_soon','expired')
      and (p_organization_id is null or r.organization_id = p_organization_id)
      -- BACKLOG J74. Only the CURRENT record per (employee, training type) is an obligation. A
      -- superseded row stays 'expired' by design; alerting on it emitted a fresh
      -- `training_expired` notification every night for training that was renewed on time.
      and not exists (
        select 1
        from public.employee_training_records newer
        where newer.employee_id = r.employee_id
          and newer.training_type_id = r.training_type_id
          and newer.id <> r.id
          and (
            coalesce(newer.due_date, '-infinity'::date),
            coalesce(newer.completion_date, '-infinity'::date),
            newer.created_at
          ) > (
            coalesce(r.due_date, '-infinity'::date),
            coalesce(r.completion_date, '-infinity'::date),
            r.created_at
          )
      )
  ),$q$;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- The other half: an alert already open against a superseded row. resolve_stale_compliance_alerts
-- closed one only when a sibling had reached 'compliant', so a requirement whose current record was
-- merely 'due_soon' kept BOTH rows' alerts open -- last cycle's overdue one and this cycle's due
-- one, for the same requirement. Same rule, applied to the resolve side.
do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.resolve_stale_compliance_alerts(uuid)'::regprocedure);

  if position('Superseded by a more current record' in v_def) > 0 then
    raise notice 'resolve_stale_compliance_alerts already resolves every superseded training alert';
  else
    v_old := $q$      or exists (
        select 1 from public.employee_training_records cur
        where cur.employee_id = r.employee_id
          and cur.training_type_id = r.training_type_id
          and cur.id <> r.id
          and cur.status = 'compliant'
      )$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'resolve_stale_compliance_alerts no longer contains the renewal test this migration patches';
    end if;
    v_new := $q$      -- BACKLOG J74. Superseded by a more current record for the same requirement, whatever
      -- that record's own status is: the obligation belongs to the current row, and only the
      -- current row's alert should stay open.
      or exists (
        select 1 from public.employee_training_records cur
        where cur.employee_id = r.employee_id
          and cur.training_type_id = r.training_type_id
          and cur.id <> r.id
          and (
            coalesce(cur.due_date, '-infinity'::date),
            coalesce(cur.completion_date, '-infinity'::date),
            cur.created_at
          ) > (
            coalesce(r.due_date, '-infinity'::date),
            coalesce(r.completion_date, '-infinity'::date),
            r.created_at
          )
      )$q$;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- B2 -- the seat clock starts at study, and the offline copy carries its position
-- ---------------------------------------------------------------------------
--
-- sync_offline_learning_action created course_progress with `started_at = now()`, which is the
-- moment of SYNC. An employee who worked a downloaded course on the bus and reconnected at the
-- building had their engagement clock started when they walked in the door -- and seat time is
-- load-bearing: complete_course_assignment's pacing gate reads it, and
-- require_comprehensive_self_completion demands the version's whole designed duration have elapsed
-- since started_at. So the offline hour was not merely uncounted, it pushed completion an hour
-- further away. (20260906220000 made the in-person path credit real seat minutes for the same
-- reason.) The client now sends the moment it first checkpointed on the device, and the server
-- clamps it into [the bundle download, now]: earlier than the sync, never earlier than the download
-- that made the study possible, never in the future.
--
-- The same call now carries the block the learner reached. Without it, syncing 100% left
-- `last_block_id` null; the live player resumed at lesson one and immediately wrote the percentage
-- back down, and for a comprehensive version the synced progress could never be the last missing
-- piece of the completion gate -- which is what made offline progress decorative.

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef(
    'public.sync_offline_learning_action(uuid,uuid,text,integer,integer,text,timestamptz,jsonb)'::regprocedure);

  if position('v_client_started_at' in v_def) > 0 then
    raise notice 'sync_offline_learning_action already starts the clock at study';
  else
    v_old := $q$declare v_device public.offline_device_registrations%rowtype;$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'sync_offline_learning_action no longer opens with the declare block this migration patches';
    end if;
    v_new := $q$declare v_client_started_at timestamptz; v_downloaded_at timestamptz; v_started_at timestamptz; v_last_block_id uuid; v_device public.offline_device_registrations%rowtype;$q$;
    v_def := replace(v_def, v_old, v_new);

    v_old := $q$    insert into public.course_progress(assignment_id,percent_complete,started_at,updated_at) values(p_assignment_id,least(greatest((p_payload->>'percentComplete')::integer,0),100),coalesce(v_progress.started_at,now()),now()) on conflict(assignment_id) do update set percent_complete=greatest(public.course_progress.percent_complete,excluded.percent_complete),started_at=coalesce(public.course_progress.started_at,excluded.started_at),updated_at=now();$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'sync_offline_learning_action no longer writes the course_progress row this migration patches';
    end if;
    v_new := $patch$    -- BACKLOG J74. Both values are client-asserted, so neither is trusted on its own: the
    -- start time is clamped between the server-recorded bundle download and now, and the block
    -- must belong to the version this assignment is pinned to. A malformed value is ignored
    -- rather than allowed to fail a sync the learner cannot retry differently.
    begin
      v_client_started_at := (p_payload->>'startedAt')::timestamptz;
    exception when others then
      v_client_started_at := null;
    end;
    begin
      v_last_block_id := (p_payload->>'lastBlockId')::uuid;
    exception when others then
      v_last_block_id := null;
    end;
    if v_last_block_id is not null and not exists (
      select 1 from public.course_blocks cb
      where cb.id = v_last_block_id and cb.course_version_id = v_assignment.course_version_id
    ) then
      v_last_block_id := null;
    end if;
    select min(m.created_at) into v_downloaded_at
    from public.offline_content_manifests m
    where m.device_id = v_device.id
      and m.course_version_id = v_assignment.course_version_id;
    v_started_at := coalesce(
      v_progress.started_at,
      greatest(
        coalesce(v_downloaded_at, now()),
        least(coalesce(v_client_started_at, now()), now())
      )
    );
    insert into public.course_progress(assignment_id, percent_complete, started_at, last_block_id, updated_at)
    values (
      p_assignment_id,
      least(greatest((p_payload->>'percentComplete')::integer, 0), 100),
      v_started_at,
      v_last_block_id,
      now()
    )
    on conflict (assignment_id) do update
      set percent_complete = greatest(public.course_progress.percent_complete, excluded.percent_complete),
          started_at = coalesce(public.course_progress.started_at, excluded.started_at),
          last_block_id = coalesce(excluded.last_block_id, public.course_progress.last_block_id),
          updated_at = now();$patch$;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- The clamp above is computed and then thrown away unless this second half lands.
--
-- protect_course_progress_timing (20260714233041) runs BEFORE INSERT on course_progress and does
-- `new.started_at := now()` unconditionally, unless `app.privileged_write` is on. That is right for
-- the browser: course_progress is directly writable by the learner through
-- useUpsertCourseProgress, and without it anyone could back-date their own seat clock and satisfy
-- every pacing gate instantly. It also meant the RPC's clamped value never reached the column, so
-- the offline hour still counted for nothing.
--
-- The clamp IS the authorization the trigger is missing: bounded below by the server-recorded
-- bundle download and above by now, it cannot claim time that was not available to spend. It is
-- applied here as its own statement -- one column, only downward, and only while the assignment is
-- still open -- so the guard is lifted for exactly this write and for nothing else in the function.

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef(
    'public.sync_offline_learning_action(uuid,uuid,text,integer,integer,text,timestamptz,jsonb)'::regprocedure);

  if position('protect_course_progress_timing stamps' in v_def) > 0 then
    raise notice 'sync_offline_learning_action already applies the clamped start time';
  elsif position('v_client_started_at' in v_def) = 0 then
    raise exception 'sync_offline_learning_action has not been given the clamped start time this migration depends on';
  else
    v_old := $q$    on conflict (assignment_id) do update
      set percent_complete = greatest(public.course_progress.percent_complete, excluded.percent_complete),
          started_at = coalesce(public.course_progress.started_at, excluded.started_at),
          last_block_id = coalesce(excluded.last_block_id, public.course_progress.last_block_id),
          updated_at = now();$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'sync_offline_learning_action no longer upserts the course_progress row this migration patches';
    end if;
    v_new := $q$    on conflict (assignment_id) do update
      set percent_complete = greatest(public.course_progress.percent_complete, excluded.percent_complete),
          started_at = coalesce(public.course_progress.started_at, excluded.started_at),
          last_block_id = coalesce(excluded.last_block_id, public.course_progress.last_block_id),
          updated_at = now();
    -- BACKLOG J74. protect_course_progress_timing stamps `new.started_at := now()` on any INSERT
    -- that is not a privileged write, so the clamped value above never reached the column and the
    -- seat clock still started at sync. The clamp is the authorization for lifting that guard: it
    -- is bounded below by the server-recorded bundle download and above by now. One column, only
    -- earlier, and only while the assignment is still open.
    if v_started_at < (
      select cp.started_at from public.course_progress cp where cp.assignment_id = p_assignment_id
    ) then
      perform set_config('app.privileged_write', 'on', true);
      update public.course_progress cp
      set started_at = v_started_at
      where cp.assignment_id = p_assignment_id
        and cp.started_at > v_started_at
        and exists (
          select 1 from public.course_assignments ca
          where ca.id = p_assignment_id and ca.status <> 'completed'
        );
      perform set_config('app.privileged_write', '', true);
    end if;$q$;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

comment on function public.sync_offline_learning_action(uuid, uuid, text, integer, integer, text, timestamptz, jsonb) is
  'Applies one offline learning action against course_progress under the device registration and '
  'the caller''s own employee record, with an append-only receipt per (device, idempotency key). A '
  'progress action carries the percentage, the moment study STARTED on the device -- clamped '
  'between the server-recorded bundle download and now, because started_at is the seat clock every '
  'completion gate reads -- and the block the learner reached, validated against the version the '
  'assignment is pinned to (BACKLOG J74).';

-- ---------------------------------------------------------------------------
-- B3 -- a cancelled assignment cannot be completed, and says so
-- ---------------------------------------------------------------------------
--
-- cancel_course_assignment (20260906130000) writes status='canceled' with canceled_at and a
-- reason, and course_assignment_cancellation_check requires those three to move together. So
-- completing a cancelled assignment set status='completed' while canceled_at stayed non-null and
-- the learner met `new row for relation "course_assignments" violates check constraint
-- "course_assignment_cancellation_check"` -- a sentence that names neither the cancellation nor
-- what to do about it. The refusal belongs here, beside the one for a completed assignment.

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.complete_course_assignment(uuid)'::regprocedure);

  if position('cancelled and cannot be completed' in v_def) > 0 then
    raise notice 'complete_course_assignment already refuses a cancelled assignment';
  else
    v_old := $q$  v_was_completed := v_assignment.status = 'completed';$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'complete_course_assignment no longer reads the prior completion state this migration patches';
    end if;
    v_new := $patch$  -- BACKLOG J74. Cancelled is closed work. Writing 'completed' over it violates
  -- course_assignment_cancellation_check, which the learner used to meet as raw constraint text.
  if v_assignment.status = 'canceled' then
    raise exception 'This training assignment was cancelled and cannot be completed. Ask a manager to assign it again if the training is still required.'
      using errcode = '55000';
  end if;

  v_was_completed := v_assignment.status = 'completed';$patch$;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- B4 -- today's class is the one that is running, not the one still in draft
-- ---------------------------------------------------------------------------
--
-- The trainer dashboard's "Start today's kiosk" read today's classes with status = 'draft'. A draft
-- is a class that has NOT been announced: "Open for enrollment" moves it to 'scheduled', which is
-- also the only status a learner can register against (useListTrainingClasses' enrollableOnly
-- filter is scheduled/in_progress). So doing the right thing -- opening the class for enrollment --
-- removed it from the dashboard button on the morning it ran, and the button instead offered a
-- kiosk for a class nobody had been invited to.

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.get_trainer_dashboard_summary()'::regprocedure);

  if position($q$status in ('scheduled', 'in_progress')$q$ in v_def) > 0 then
    raise notice 'get_trainer_dashboard_summary already lists today''s live classes';
  else
    v_old := $q$todays_classes as (
  select id, class_name
  from public.training_classes
  where class_date = (select today from params)
    and status = 'draft'
  order by class_name
),$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'get_trainer_dashboard_summary no longer selects today''s classes the way this migration patches';
    end if;
    v_new := $q$todays_classes as (
  -- BACKLOG J74. The sessions a kiosk is for: open for enrollment, or already running. This used
  -- to read status = 'draft', so a class vanished from the dashboard the moment its trainer opened
  -- it for enrollment. Drafts are still counted by class_stats.draft_classes above.
  select id, class_name
  from public.training_classes
  where class_date = (select today from params)
    and status in ('scheduled', 'in_progress')
  order by class_name
),$q$;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- B6 -- the transcript prints the credit the compliance model recorded, or nothing
-- ---------------------------------------------------------------------------
--
-- The public passport printed "CE hours" equal to courses.estimated_duration_minutes / 60 under a
-- "Verified transcript" badge. That number is how long the course is expected to take. It is not a
-- continuing-education credit, CareMetric accredits nothing, and no part of the compliance model
-- ever asserted it as one. What the model does record is course_completion_credits.credit_hours --
-- written by record_course_completion_credits from the governed, citation-carrying
-- course_compliance_credits rows, behind the same evidence gates as the certificate itself.
--
-- max(), not sum(): a course version can credit several topics from one sitting, and
-- record_course_completion_credits itself reads `max(cc.credit_hours * 3600)` as the seat time that
-- sitting must cover. They are parallel claims on the same hours, not additive ones.
--
-- A certificate with no recorded credit now returns creditHours null, and the page prints nothing
-- for it. A blank is honest; a number nobody stands behind is not.

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.verify_training_passport(text)'::regprocedure);

  if position('creditHours' in v_def) > 0 then
    raise notice 'verify_training_passport already reports recorded compliance credit';
  else
    v_old := $q$  v_total_hours numeric;$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'verify_training_passport no longer declares the hours total this migration patches';
    end if;
    v_new := $q$  v_total_hours numeric;
  v_credited_count integer;$q$;
    v_def := replace(v_def, v_old, v_new);

    v_old := $q$  select count(*),
    coalesce(sum(coalesce(c.estimated_duration_minutes, 0)) / 60.0, 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'certificateId', cert.id,
      'credentialNumber', cert.credential_number,
      'courseTitle', c.title,
      'issuedAt', cert.issued_at,
      'expiresAt', cert.expires_at,
      'isValid', cert.expires_at is null or cert.expires_at > now(),
      'verificationPath', '/verify/' || cert.slug,
      'ceHours', round(coalesce(c.estimated_duration_minutes, 0) / 60.0, 2)
    ) order by cert.issued_at desc), '[]'::jsonb)
  into v_certificate_count, v_total_hours, v_certificates
  from public.certificates cert
  join public.courses c on c.id = cert.course_id
  where cert.employee_id = v_employee.id$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'verify_training_passport no longer builds the certificate list this migration patches';
    end if;
    v_new := $q$  select count(*),
    coalesce(sum(credited.credit_hours), 0),
    count(*) filter (where credited.credit_hours is not null),
    coalesce(jsonb_agg(jsonb_build_object(
      'certificateId', cert.id,
      'credentialNumber', cert.credential_number,
      'courseTitle', c.title,
      'issuedAt', cert.issued_at,
      'expiresAt', cert.expires_at,
      'isValid', cert.expires_at is null or cert.expires_at > now(),
      'verificationPath', '/verify/' || cert.slug,
      -- BACKLOG J74. The recorded compliance credit for this completion, or null. Never the
      -- course's estimated duration dressed up as a CE hour.
      'creditHours', credited.credit_hours
    ) order by cert.issued_at desc), '[]'::jsonb)
  into v_certificate_count, v_total_hours, v_credited_count, v_certificates
  from public.certificates cert
  join public.courses c on c.id = cert.course_id
  left join lateral (
    select max(cr.credit_hours) as credit_hours
    from public.course_completion_credits cr
    where cr.course_assignment_id = cert.course_assignment_id
  ) credited on true
  where cert.employee_id = v_employee.id$q$;
    v_def := replace(v_def, v_old, v_new);

    v_old := $q$    'certificateCount', v_certificate_count,
    'totalCeHours', round(v_total_hours, 2),$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'verify_training_passport no longer returns the totals this migration patches';
    end if;
    v_new := $q$    'certificateCount', v_certificate_count,
    'totalCreditHours', round(v_total_hours, 2),
    'creditedCertificateCount', coalesce(v_credited_count, 0),$q$;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

comment on function public.verify_training_passport(text) is
  'Public, unauthenticated read of an active training passport. Hours are the compliance credit '
  'recorded for each completion (course_completion_credits.credit_hours) and null where none was '
  'recorded -- never the course''s estimated duration, which the passport used to print as "CE '
  'hours" on a page badged "Verified transcript" (BACKLOG J74).';

-- ---------------------------------------------------------------------------
-- F3 -- an announcement is visible to the person who published it
-- ---------------------------------------------------------------------------
--
-- org_announcements_visible tests the reader against the announcement's own audience, and nothing
-- else. A facility manager who broadcast to "employee" could not see the message they had just
-- sent: not in the list, no read receipt to open, no way to check the wording or notice a typo, and
-- no way to tell a failed publish from a successful one. Authorship is its own reason to see a row.

do $do$
declare
  v_qual text;
begin
  select pg_get_expr(polqual, polrelid) into v_qual
  from pg_policy
  where polrelid = 'public.org_announcements'::regclass and polname = 'org_announcements_visible';
  if v_qual is null then raise exception 'org_announcements_visible is missing'; end if;

  if position('created_by' in v_qual) > 0 then
    raise notice 'org_announcements_visible already admits the publisher';
    return;
  end if;

  execute format(
    'alter policy org_announcements_visible on public.org_announcements using (%s or (organization_id = (select public.current_org_id()) and created_by = (select auth.uid())))',
    v_qual
  );
end;
$do$;

-- ---------------------------------------------------------------------------
-- F7 -- a job aide's audience is a set of roles, not free text
-- ---------------------------------------------------------------------------
--
-- isHelpArticleVisibleToRole() shows a job_aide only when `content->'audience'` is an array
-- containing the reader's role. The column is plain jsonb with no shape at all, so one mistyped
-- role -- "faciilty_manager", "admin", a string where an array belongs -- hid the aide from
-- everybody, with no error at write time and nothing on any screen to notice. help_articles is
-- writable only by platform admins (help_articles_write), which is to say by a migration or a
-- console session, which is exactly where a typo goes unreviewed.
--
-- Every existing job_aide row satisfies this (28 rows, checked). FAQ rows are unaffected.

alter table public.help_articles
  drop constraint if exists help_articles_job_aide_audience_check;

-- jsonb containment is the whole test and needs no subquery (a check constraint may not have
-- one): `a <@ b` on arrays is true exactly when every element of `a` appears in `b`, which also
-- rules out a non-string element, since no number equals any of these strings.
alter table public.help_articles
  add constraint help_articles_job_aide_audience_check check (
    article_type <> 'job_aide'
    or (
      jsonb_typeof(content -> 'audience') = 'array'
      and jsonb_array_length(content -> 'audience') > 0
      and (content -> 'audience')
            <@ '["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"]'::jsonb
    )
  );

comment on constraint help_articles_job_aide_audience_check on public.help_articles is
  'A job aide is shown only to the roles named in content->audience, so an unrecognised role name '
  'hides it from everyone with no error and nothing on screen to notice (BACKLOG J74). The audience '
  'must be a non-empty array of real role names.';
