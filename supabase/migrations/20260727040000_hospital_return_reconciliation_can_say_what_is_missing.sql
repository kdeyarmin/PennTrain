-- The hospital-return reconciliation never told anyone what was outstanding.
--
-- complete_hospital_return_reconciliation collects the still-missing pieces of a hospital return --
-- discharge paperwork, medication reconciliation, physician order acknowledgement, the return
-- assessment review, the support-plan revision -- into a text[] and refuses to close the episode
-- until the list is empty, naming what remains:
--
--     raise exception 'Hospital return cannot be closed while these remain outstanding: %', ...
--
-- It appended to that list with `v_outstanding := v_outstanding || 'discharge paperwork'`. A bare
-- quoted literal is `unknown`, and Postgres resolves `anyarray || unknown` as array-to-array, so it
-- tries to read "discharge paperwork" as an array literal and raises:
--
--     ERROR:  malformed array literal: "discharge paperwork"   (22P02)
--     DETAIL: Array value must start with "{" or dimension information.
--
-- So the function works only when NOTHING is outstanding. The moment a manager tries to close a
-- return that still has a gap -- the case the whole function exists for -- it dies with a raw
-- Postgres type error instead of the sentence that says which gap. All five branches are affected.
--
-- Found by `supabase db lint`, which has been reporting it since it shipped in 20260726070100.
-- CI runs the linter without --fail-on error, so it printed the finding and went green. Nothing else
-- could have caught it: complete_hospital_return_reconciliation has no pgTAP coverage at all, which
-- is why hospital_return_reconciliation_reports_gaps.test.sql is added alongside this. That test
-- drives the failing path first -- an episode with every gap open -- and only then the clean one,
-- because a test that closes a complete episode passes just as happily against the broken function.
--
-- array_append rather than a cast, because `|| 'x'::text` would fix this instance and leave the next
-- person to rediscover the resolution rule.

CREATE OR REPLACE FUNCTION public.complete_hospital_return_reconciliation(p_episode_id uuid, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.hospital_transfer_episodes%rowtype;
  v_outstanding text[] := array[]::text[];
  v_review_final boolean;
  v_plan_revised boolean;
begin
  select * into v from public.hospital_transfer_episodes where id = p_episode_id for update;
  if not found then raise exception 'Transfer episode not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status <> 'returned' then
    raise exception 'Only a returned episode can be reconciled' using errcode = '22023';
  end if;

  if v.discharge_document_id is null then
    v_outstanding := array_append(v_outstanding, 'discharge paperwork');
  end if;
  if v.medication_reconciliation_status not in ('completed', 'authorized_exception', 'not_applicable') then
    v_outstanding := array_append(v_outstanding, 'medication reconciliation');
  end if;
  if v.changed_order_ack_status not in ('acknowledged', 'not_applicable') then
    v_outstanding := array_append(v_outstanding, 'physician order acknowledgement');
  end if;

  if v.assessment_review_required then
    select exists (
      select 1 from public.resident_assessment_reviews r
      where r.hospital_episode_id = v.id and r.status = 'final'
    ) into v_review_final;
    if not coalesce(v_review_final, false) then
      v_outstanding := array_append(v_outstanding, 'hospital-return assessment review');
    end if;
  end if;

  if v.support_plan_review_required then
    -- Either a plan that took effect after the return, or one still in flight being revised because
    -- of it. Requiring an *active* plan would block closure while the revision is legitimately in
    -- clinical review.
    select exists (
      select 1 from public.resident_support_plans p
      where p.resident_id = v.resident_id
        and (
          (p.state = 'active' and p.effective_date >= public.pa_day(v.return_time))
          or p.state in ('draft','awaiting_clinical_review','awaiting_participation','awaiting_signature','approved')
        )
    ) into v_plan_revised;
    if not coalesce(v_plan_revised, false) then
      v_outstanding := array_append(v_outstanding, 'support-plan revision');
    end if;
  end if;

  if cardinality(v_outstanding) > 0 then
    raise exception 'Hospital return cannot be closed while these remain outstanding: %',
      array_to_string(v_outstanding, ', ') using errcode = '22023';
  end if;

  update public.work_items set
    state = 'closed',
    closure_reason = left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Hospital-return reconciliation completed'), 1000),
    closed_at = now(),
    updated_at = now()
  where id = v.return_work_item_id and state not in ('closed', 'canceled');

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'hospital_transfer_episode', v.id::text,
    'hospital_transfer.reconciliation_completed',
    jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')));
  return true;
end $function$

;
