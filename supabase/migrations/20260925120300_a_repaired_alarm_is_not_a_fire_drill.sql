-- A repair is not a fire drill, and a dead alarm is a 48-hour repair.
--
-- BACKLOG.md REG27. Two defects in the environmental work-order flow, read against 55 Pa. Code
-- 2600.130 / 2800.130 and 2600.132 / 2800.132 and DHS's Regulatory Compliance Guide for
-- Chapter 2600 (revised August 1, 2021).
--
--   1. VERIFYING A REPAIR LOGGED A PASSING FIRE DRILL. verify_work_order inserts a 'pass'
--      inspection_event dated pa_today() on the work order's inspection item. For a fire drill
--      program, recalculate_inspection_item_compliance counts that event as the month's drill and
--      generate-fire-drill-tracker-pdf prints "Met -- 1 passing drill logged this month", with every
--      2600.132(c) field blank. The work order behind it is usually the one
--      create_work_order_from_failed_inspection opened for an unsuccessful drill, so the product
--      turned "the drill failed" into "the drill passed" the moment the fix was signed off.
--      2600.132(a) requires an unannounced drill every month and 132(c) a record of it; the RCG's
--      drill discussion treats "documentation of subsequent successful drills" as the evidence of
--      corrective action, alongside the documented repair, not as something the repair supplies.
--      The same insert rolled an evacuation-time letter (132(d), written by a fire safety expert)
--      or an emergency plan review (2600.107 / 2800.107) forward a full cycle. A verified repair now
--      writes an event only for equipment, where it is a test of the thing that was fixed; a
--      procedural item stays due until the procedure itself is logged.
--
--   2. AN INOPERATIVE SMOKE DETECTOR OR FIRE ALARM GOT A 7-DAY WORK ORDER. 2600.130(g) /
--      2800.130(f): "repair shall be completed within 48 hours of the time the detector or alarm was
--      found to be inoperative." create_work_order_from_failed_inspection gave every
--      deficiency_noted result a routine 7-day target, detectors and alarms included, and a drill
--      recorded with "alarm or detector operative: No" (a 132(c) element) opened nothing at all when
--      its result was 'pass'. Both now open an urgent work order due in 48 hours; a 'fail' keeps its
--      24 hours, which is inside the window.
--
-- verify_work_order has been amended by several migrations, so it is spliced from its deployed body
-- with a guarded replace (the pattern 20260906270000 used). create_work_order_from_failed_inspection
-- has only ever had the one body (20260713163602), which is restated here with the two changes.

------------------------------------------------------------------------------------------------
-- 1. A verified repair writes an event only for equipment
------------------------------------------------------------------------------------------------
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.verify_work_order(uuid, text, text)'::regprocedure);
  v_old := $old$      insert into public.inspection_events(
        organization_id, facility_id, inspection_item_id, performed_date,
        performed_by, performed_by_profile_id, result, follow_up_required, notes
      ) values (
        v.organization_id, v.facility_id, v.inspection_item_id, public.pa_today(),
        coalesce(nullif(v_verifier_name, ''), 'Maintenance supervisor'), auth.uid(),
        'pass', false, format('%s verified after repair: %s', v.work_order_number, btrim(p_verification_notes))
      );$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'verify_work_order no longer contains the inspection-event insert this migration guards';
  end if;
  v_new := $patch$      -- A verified repair tests the equipment it fixed. It is not a fire drill (2600.132(a), (c)),
      -- a fire safety expert's evacuation letter (132(d)) or an emergency plan review (2600.107),
      -- so a procedural item gets no event and stays due until the procedure is logged.
      if (select i.item_kind from public.inspection_items i where i.id = v.inspection_item_id) = 'equipment' then
        insert into public.inspection_events(
          organization_id, facility_id, inspection_item_id, performed_date,
          performed_by, performed_by_profile_id, result, follow_up_required, notes
        ) values (
          v.organization_id, v.facility_id, v.inspection_item_id, public.pa_today(),
          coalesce(nullif(v_verifier_name, ''), 'Maintenance supervisor'), auth.uid(),
          'pass', false, format('%s verified after repair: %s', v.work_order_number, btrim(p_verification_notes))
        );
      end if;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

------------------------------------------------------------------------------------------------
-- 2. A dead detector or alarm is a 48-hour repair, wherever it was found
------------------------------------------------------------------------------------------------
create or replace function public.create_work_order_from_failed_inspection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item public.inspection_items%rowtype;
  v_id uuid;
  v_alarm_down boolean := new.alarm_or_detector_operative is false;
  v_alarm_item boolean;
begin
  if new.result not in ('fail','deficiency_noted') and not v_alarm_down then return new; end if;
  if exists (select 1 from public.work_orders w where w.source_inspection_event_id = new.id) then return new; end if;
  select * into v_item from public.inspection_items where id = new.inspection_item_id;
  -- 2600.130(g) / 2800.130(f): repair "within 48 hours of the time the detector or alarm was found
  -- to be inoperative" -- on its own inspection, or on a drill record that says it did not work.
  v_alarm_item := v_alarm_down or v_item.item_type in ('smoke_detector', 'fire_alarm_system');
  insert into public.work_orders(
    organization_id, facility_id, work_order_number, source_inspection_event_id,
    inspection_item_id, location_detail, problem_description, safety_risk,
    priority, target_completion_at, created_by_profile_id
  ) values (
    new.organization_id, new.facility_id, 'pending', new.id, new.inspection_item_id,
    v_item.location_detail,
    case
      when new.result = 'pass' then format(
        '%s: the fire alarm or smoke detector was not operative during the drill. Repair within 48 hours (55 Pa. Code 2600.130(g) / 2800.130(f)).',
        v_item.label)
      else format('%s inspection %s: %s', v_item.label, replace(new.result, '_', ' '),
        coalesce(nullif(new.deficiency_notes, ''), 'Follow-up repair required'))
    end,
    case when new.result = 'fail' or v_alarm_item then 'high' else 'moderate' end,
    case when new.result = 'fail' or v_alarm_item then 'urgent' else 'routine' end,
    case
      when new.result = 'fail' then now() + interval '24 hours'
      when v_alarm_item then now() + interval '48 hours'
      else now() + interval '7 days'
    end,
    coalesce(new.performed_by_profile_id, auth.uid())
  ) returning id into v_id;
  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, resulting_status,
    actor_profile_id, notes, metadata
  ) values (
    new.organization_id, new.facility_id, v_id, 'created', 'open',
    coalesce(new.performed_by_profile_id, auth.uid()),
    case when new.result = 'pass'
      then 'Automatically generated: alarm or detector not operative during the drill'
      else 'Automatically generated from failed inspection'
    end,
    jsonb_build_object('inspectionEventId', new.id)
  );
  return new;
end;
$function$;
