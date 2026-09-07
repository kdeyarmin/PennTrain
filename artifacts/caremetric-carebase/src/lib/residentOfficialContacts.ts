/**
 * Whether a resident's official contacts may be edited, and the set an edit starts from.
 *
 * WHY THIS EXISTS. `save_resident_administrative_master(p_resident_id, p_profile, p_contacts)` does
 * not merge. Its first act on the contact table is
 *
 *     update public.resident_contacts set active = false, is_primary = false
 *     where resident_id = v_resident.id and active;
 *
 * and it then re-activates only the rows present in `p_contacts`. So that argument is the resident's
 * COMPLETE contact set, and anything missing from it is deactivated -- across all twelve stored
 * types: emergency_contact, designated_person, guardian, power_of_attorney, primary_care_provider,
 * dentist, pharmacy, case_manager, hospice_agency, home_health_agency, insurer, other.
 *
 * Both editors built that argument from `administrativeMaster?.contacts ?? []`, and `undefined`
 * there means two different things: "this resident has no contacts" and "the query has not answered
 * yet, or failed". The second is the dangerous one. Saving from it sends a set that is missing every
 * contact the form does not itself rebuild -- for the overview dialog that is the eight types it
 * never touches -- and the resident's emergency contact, guardian, power of attorney, pharmacy,
 * hospice and home-health agencies and insurer are deactivated without a word. On a personal care
 * home resident that is the information the facility reaches for in an emergency and is required to
 * keep on file.
 *
 * It is not only a race: a FAILED master query leaves the data undefined for as long as the page is
 * open, so every save from that state wipes those contacts deterministically.
 *
 * `masterLoaded` should be the query's `isSuccess`, not `!isLoading`: an error is not an answer
 * either, and an edit built on a guess about what was on file is worse than one the user retries.
 *
 * Both components already drew this distinction for DISPLAY -- OverviewTab passes
 * `isError || isLoading` down as `dataUnavailable`, and ResidentAdministrativeMaster renders
 * "Contacts unavailable." from it -- so the rule was understood; it just never reached the write.
 */
export type OfficialContactEditStart<T> =
  | { canEdit: false }
  | { canEdit: true; contacts: T[] };

export function officialContactEditStart<T extends object>(
  masterLoaded: boolean,
  contacts: readonly T[] | undefined,
): OfficialContactEditStart<T> {
  if (!masterLoaded || !contacts) return { canEdit: false };
  // Copied, not aliased: the caller snapshots this at open time and diffs against it at save time,
  // the way OverviewTab already snapshots informal-support ids, so a background refetch while the
  // dialog is open cannot change what the save is about to replace.
  return { canEdit: true, contacts: contacts.map((contact) => ({ ...contact })) };
}
