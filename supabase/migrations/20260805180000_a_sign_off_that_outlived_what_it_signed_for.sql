-- Adding a required preparation item after the pre-departure sign-off left the sign-off standing.
--
-- `set_appointment_preparation_item_ready` already states the rule, and states it well:
--
--   -- Reopening an item after the pre-departure sign-off would leave `preparation_completed_at`
--   -- asserting something that is no longer true. Clear the sign-off in the same statement.
--
-- `add_appointment_preparation_item` is the other way to make it untrue and did not. Its item
-- defaults to `required => true` and `ready` is `false` on insert, so adding one to an appointment
-- that has already been signed off produces exactly the state the reopen guard exists to prevent:
-- `preparation_completed_at` set, with a required item outstanding. The ON CONFLICT branch gets
-- there too -- promoting an existing not-ready item from optional to required is the same
-- transition by a different route.
--
-- It is not a display quibble. `complete_appointment_preparation` refuses while anything required
-- is outstanding, and having refused once it cannot be asked again on an appointment that is
-- already signed off, so the new item never gets its gate. The nurse who adds "oxygen cylinder"
-- twenty minutes before transport sees a green pre-departure sign-off on an appointment that has
-- an outstanding required item, and the sign-off is the thing that is meant to say otherwise.
--
-- The clear is conditional on the item actually being required and not ready: adding an optional
-- item, or re-adding one already ticked, changes nothing about whether preparation is complete and
-- must not invalidate a sign-off that is still true.
--
-- Redeclared from 20260804110000; the insert and every check above it are carried forward verbatim
-- and the new block is marked CHANGE inline.
--
-- Rollback: CREATE OR REPLACE the version from 20260804110000_resident_appointment_lifecycle.sql.

create or replace function public.add_appointment_preparation_item(
  p_appointment_id uuid,
  p_item_kind text,
  p_label text,
  p_required boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_appointments%rowtype;
  v_id uuid;
  v_outstanding boolean;
begin
  select * into v from public.resident_appointments where id = p_appointment_id;
  if not found then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if p_item_kind not in ('document', 'equipment', 'task') then
    raise exception 'Unknown preparation item kind' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_label, '')), '') is null then
    raise exception 'A preparation item needs a label' using errcode = '22023';
  end if;

  insert into public.resident_appointment_preparation_items(
    organization_id, facility_id, appointment_id, item_kind, label, required
  )
  values (v.organization_id, v.facility_id, v.id, p_item_kind, btrim(p_label), coalesce(p_required, true))
  on conflict (appointment_id, item_kind, label) do update set required = excluded.required, updated_at = now()
  returning id, (required and not ready) into v_id, v_outstanding;

  -- CHANGE (20260805180000): the same rule set_appointment_preparation_item_ready states for a
  -- reopened item. A required item that is not ready makes `preparation_completed_at` assert
  -- something untrue, and complete_appointment_preparation cannot be called again on an
  -- appointment that is already signed off, so nothing else would ever re-gate it.
  if coalesce(v_outstanding, false) and v.preparation_completed_at is not null then
    update public.resident_appointments
      set preparation_completed_at = null, preparation_completed_by = null, updated_at = now()
      where id = v.id;
  end if;

  return v_id;
end $$;
