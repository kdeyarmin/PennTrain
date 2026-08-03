-- Resident photos for right-patient verification on the caregiver charting surface.
--
-- WHAT THIS CHANGES, STATED PLAINLY. 20260705183142_resident_documents_storage_bucket.sql opens with
-- "no self-service branch (no employee/resident owner to grant read access to)". That was true when
-- written: the employee role had no reach into resident data at all. The clinical lane
-- (20260725100000) changed that -- an employee actively assigned to a facility may now read and chart
-- that facility's residents through app_private.clinical_record_visible. This migration extends the
-- same, already-established reach to exactly one document per resident: the one
-- residents.photo_document_id points at. Charting a vital on the wrong resident is the classic
-- bedside error, and a name-and-room row is a weak defence against it.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It does not give employees resident_documents generally. An
-- employee still cannot read a contract, a resident-rights acknowledgment, an assessment PDF, a
-- state form, or any other uploaded document -- including other documents belonging to the very
-- resident whose photo they may see. The predicate is "this row IS some resident's designated photo,
-- and I may see that resident clinically", not "this row belongs to a resident I may see".
--
-- WHY TWO SECURITY DEFINER HELPERS RATHER THAN INLINE EXISTS CLAUSES. Both predicates have to reach
-- public.residents, and residents_select (20260705183133) has no employee branch at all -- an inline
-- `exists (select 1 from public.residents ...)` inside a policy runs under the caller's own RLS and
-- would therefore evaluate to false for precisely the role this migration is for. The failure would
-- be silent (a missing photo, not an error), so the rule lives in SECURITY DEFINER helpers that
-- state it once and are not subject to that filtering. The same reasoning is why the storage policy
-- gets its own path-keyed helper instead of joining through resident_documents, which would put one
-- RLS-protected table's policy in the evaluation path of another's.

-- ---------------------------------------------------------------------------
-- 1. The rule, in one place, twice keyed (by document id, and by storage object name)
-- ---------------------------------------------------------------------------

create or replace function app_private.resident_photo_document_visible(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.residents r
    join public.resident_documents d on d.id = r.photo_document_id
    where r.photo_document_id = p_document_id
      -- "Designated as the photo" is not by itself proof the row IS a photo.
      -- save_resident_administrative_master (20260713183435) validates only that the document
      -- belongs to the resident -- it does not require an image -- so an admission manager can
      -- point photo_document_id at that resident's contract or assessment PDF through the
      -- sanctioned RPC, with no UI involved. Without this predicate that document would become
      -- employee-readable, which is precisely the widening this migration exists to avoid. The
      -- check belongs here rather than on the write path: tightening the RPC would not retract a
      -- designation already stored, and this is the boundary actually being widened.
      and d.file_type like 'image/%'
      and app_private.clinical_record_visible(r.organization_id, r.facility_id)
  )
$$;
revoke all on function app_private.resident_photo_document_visible(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.resident_photo_document_visible(uuid) to authenticated;

create or replace function app_private.resident_photo_object_visible(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.resident_documents d
    join public.residents r on r.photo_document_id = d.id
    where d.storage_bucket = 'resident-documents'
      and d.storage_path = p_object_name
      -- Same reason as the document predicate above: a designation is not a MIME type.
      and d.file_type like 'image/%'
      and app_private.clinical_record_visible(r.organization_id, r.facility_id)
  )
$$;
revoke all on function app_private.resident_photo_object_visible(text)
  from public, anon, authenticated, service_role;
grant execute on function app_private.resident_photo_object_visible(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Table policy: one additional, narrowly-scoped branch
-- ---------------------------------------------------------------------------

drop policy if exists resident_documents_select on public.resident_documents;
create policy resident_documents_select on public.resident_documents for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
  -- Caregiver right-patient verification: this row is a resident's designated photo and the caller
  -- may see that resident clinically. No other document reaches this branch.
  or ((select public.current_role()) = 'employee'
      and app_private.resident_photo_document_visible(id))
);

-- ---------------------------------------------------------------------------
-- 3. Storage policy: the same branch, keyed by object name
-- ---------------------------------------------------------------------------

drop policy if exists "resident-documents read" on storage.objects;
create policy "resident-documents read" on storage.objects for select to authenticated using (
  bucket_id = 'resident-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid))))
    -- Caregiver right-patient verification. The helper re-derives the facility from the resident
    -- that owns the photo rather than trusting the object's own path prefix, so a mislabeled path
    -- cannot widen what an employee can read.
    or ((select public.current_role()) = 'employee'
        and app_private.resident_photo_object_visible(name))
  )
);

-- ---------------------------------------------------------------------------
-- 4. Handing the client the paths it may sign
-- ---------------------------------------------------------------------------
--
-- An employee cannot read public.residents, so they cannot learn a photo_document_id on their own.
-- This returns only residents already visible through the same clinical helper the roster uses, and
-- only the storage coordinates -- the signed URL itself is minted by storage under the policy above,
-- which is where the real gate sits.
create or replace function public.get_clinical_chart_resident_photos()
returns table (resident_id uuid, storage_bucket text, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, d.storage_bucket, d.storage_path
  from public.residents r
  join public.resident_documents d on d.id = r.photo_document_id
  where r.status in ('active', 'temporarily_out', 'hospital_leave')
    -- Same image guard as the two predicates. Without it this RPC would hand the client a path for
    -- a designated non-image, the storage policy would then refuse to sign it, and the caregiver
    -- would see an unexplained missing avatar rather than the initials fallback.
    and d.file_type like 'image/%'
    and app_private.clinical_record_visible(r.organization_id, r.facility_id)
$$;
revoke all on function public.get_clinical_chart_resident_photos() from public, anon, service_role;
grant execute on function public.get_clinical_chart_resident_photos() to authenticated;
