/**
 * The two fields both offline draft safety gates forgot: `createdAt` and `syncState`.
 *
 * BACKLOG.md open question 5. Every other field in both lanes is validated, and these two were
 * not — which matters precisely because they are not payload, they are the fields the local
 * lifecycle runs on:
 *
 *   - `createdAt` feeds both purge clocks (UNSYNCED_PURGE_AFTER_MS, NEEDS_REVIEW_PURGE_AFTER_MS)
 *     and the "unsynced for over a day" warning. All three compare `now - Date.parse(createdAt)`,
 *     and `Date.parse` of an unparseable string is NaN. Every comparison against NaN is false, so
 *     the draft is never overdue, never expired, and never purged: it sits on the device forever,
 *     holding care documentation nobody is being told about.
 *   - `syncState` decides which list a draft appears in. The panel renders only the drafts whose
 *     state is in UNRESOLVED or NEEDS_REVIEW, and its "is there anything to show" guard counts the
 *     same two sets — so a draft with an unrecognized state is not merely mis-sorted, it is
 *     invisible, and combined with the above it is invisible forever.
 *
 * The write paths always set both correctly, so this only bites as the tamper/corruption gate the
 * safety modules claim to be — which is the whole reason they exist: a record read back from
 * IndexedDB is not trusted just because this code wrote it.
 *
 * SHARED RULE, PER-LANE VOCABULARY. The service lane knows `conflict` and `stale`; the observation
 * lane deliberately does not, because a vital sign has no shared row for someone else to take
 * first. So the states are passed in rather than hardcoded here — the rule is common, the alphabet
 * is not. Keeping the rule in one place is what stops the two lanes drifting the way the backlog
 * note warned they would.
 */

/** Rejects a timestamp the purge clocks would silently evaluate to NaN forever. */
export function assertParseableTimestamp(value: unknown, field: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(
      `Offline draft field "${field}" is not a parseable timestamp; the purge clock would never `
      + "expire this record",
    );
  }
}

/** Rejects a lifecycle state outside the lane's own declared set. */
export function assertKnownSyncState(value: unknown, allowed: readonly string[], field: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(
      `Offline draft field "${field}" is "${String(value)}", which is not a recognized sync state; `
      + "the drafts panel would never show this record",
    );
  }
}

/** Both checks, for a gate that has already validated everything lane-specific. */
export function assertDraftLifecycleFields(
  draft: { createdAt: unknown; syncState: unknown },
  allowedStates: readonly string[],
): void {
  assertParseableTimestamp(draft.createdAt, "createdAt");
  assertKnownSyncState(draft.syncState, allowedStates, "syncState");
}
