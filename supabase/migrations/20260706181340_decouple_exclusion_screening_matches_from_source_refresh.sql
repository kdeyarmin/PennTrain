-- Forward-fix (review finding): the monthly OIG LEIE/SAM.gov refresh (screen-exclusions Edge
-- Function) deletes and re-inserts exclusion_list_entries wholesale for a source
-- (`delete ... where source = ...` then bulk insert), with each re-inserted row getting a brand-new
-- random gen_random_uuid() id -- there is no upsert on a natural key.
--
-- exclusion_screening_matches.exclusion_list_entry_id is declared `on delete cascade`, so every
-- monthly refresh silently CASCADE-DELETES every exclusion_screening_matches row (and, via its own
-- `on delete cascade`, every linked alerts row) tied to the old, now-replaced exclusion_list_entries
-- row -- destroying the reviewed_by/reviewed_at/reviewed_notes audit trail of any match an org_admin
-- already reviewed (confirmed_exclusion OR dismissed as a false_positive common-name collision).
-- match_exclusion_list_against_roster_core() then re-matches against the newly-inserted
-- (differently-IDed) entry and inserts a brand-new pending_review match plus a brand-new critical
-- alert for the exact same person, re-opening a case that was already resolved, every month, with no
-- way to ever permanently dismiss a name collision.
--
-- Fix at the FK: exclusion_list_entries is explicitly an ephemeral, wholesale-replaced federal
-- dataset mirror (see its own table comment), so exclusion_screening_matches must not depend on a
-- specific row of it surviving a refresh. matched_name and source are already denormalized directly
-- onto exclusion_screening_matches (independent columns, not derived through the FK'd row), so
-- everything the review UI displays already survives a refresh on its own -- the match row itself
-- just needs to stop being destroyed. Change the FK from CASCADE to SET NULL (dropping the NOT NULL
-- constraint it requires) so a source refresh un-links a match from the now-gone raw entry without
-- deleting the match, its review decision, or its linked alert.
alter table public.exclusion_screening_matches
  alter column exclusion_list_entry_id drop not null;

alter table public.exclusion_screening_matches
  drop constraint exclusion_screening_matches_exclusion_list_entry_id_fkey,
  add constraint exclusion_screening_matches_exclusion_list_entry_id_fkey
    foreign key (exclusion_list_entry_id) references public.exclusion_list_entries(id) on delete set null;
