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

/**
 * Codex review finding, and the sharper half of the gap above.
 *
 * assertDraftLifecycleFields validates the copy of these fields INSIDE the encrypted envelope, on
 * save and on decrypt. But the panel's counts and both purge clocks never decrypt anything -- they
 * read the separate PLAINTEXT `syncState` and `createdAt` columns the store keeps as a cheap index.
 * Corrupting those two while leaving the envelope untouched therefore still produced exactly the
 * record this module was written to prevent: invisible to the panel and immortal against the purge.
 * Validating only the inner copy defended the threat model's name and not its substance.
 *
 * Coerced rather than thrown on, because these run inside a listing that must keep working: one bad
 * record must not make the whole store unreadable, which would hide every OTHER pending draft too.
 * Both fallbacks fail toward visible-and-expirable, the opposite of the failure being fixed:
 *
 *   - an unusable state becomes "error", which is in every lane's unresolved set, so the record is
 *     listed, retried, and subject to the purge clock;
 *   - an unusable timestamp becomes the epoch, which reads as maximally overdue -- so it is flagged
 *     immediately and purged on schedule rather than sitting there forever.
 *
 * `updatedAt` is the last-attempt clock (BACKLOG.md I6). It is optional on input because records
 * written before that column existed do not carry it, and it falls back to `createdAt` -- which is
 * the clock the purge used for every state before this -- so an old record is treated exactly as it
 * was. Its own unusable-value fallback is the same, and lands on the expirable side for the same
 * reason the other two do.
 */
export function coerceListedLifecycle<TState extends string>(
  syncState: unknown,
  createdAt: unknown,
  allowedStates: readonly TState[],
  updatedAt?: unknown,
): { syncState: TState; createdAt: string; updatedAt: string } {
  const stateOk = typeof syncState === "string" && (allowedStates as readonly string[]).includes(syncState);
  const createdOk = typeof createdAt === "string" && !Number.isNaN(Date.parse(createdAt));
  const created = createdOk ? (createdAt as string) : new Date(0).toISOString();
  const updatedOk = typeof updatedAt === "string" && !Number.isNaN(Date.parse(updatedAt));
  // "error" is a member of both lanes' unions; the cast is what lets one helper serve both without
  // widening DraftListEntry.syncState to string, which would defeat the exhaustiveness the callers
  // rely on.
  return {
    syncState: (stateOk ? syncState : "error") as TState,
    createdAt: created,
    updatedAt: updatedOk ? (updatedAt as string) : created,
  };
}

/**
 * A refusal the server made, and will make again (BACKLOG.md I6 residual).
 *
 * Both sync loops catch every throw and store `syncState: "error"`, which is an UNRESOLVED state --
 * so the runner picks the draft up again on its next pass, five minutes later, forever. That is
 * right for a draft that never reached the server. It is wrong for one the server executed and
 * refused: a resident deleted since the draft was written (P0002), an employee deactivated while
 * it sat on the device (42501), a receipt row whose foreign key no longer resolves (23503). Those
 * answers do not change with time, so retrying produces a request every five minutes for as long
 * as the device is signed in, and the aide is never told the note did not land.
 *
 * `rejected` already exists in both lanes, is already rendered as needs-review with the server's
 * message, and is already dismissible by a human. Nothing reached it.
 *
 * The classification has to be conservative in one direction and only one: sending a draft to
 * needs-review that WOULD have succeeded costs a person a look at a queue; leaving a doomed draft
 * retrying costs nobody anything visible, which is exactly why it went unnoticed. So a failure
 * counts against the draft only when the server plainly executed and refused.
 *
 *   - A client-side network failure carries `code: ""` -- @supabase/postgrest-js populates neither
 *     code nor hint before an HTTP response exists (see isNetworkLevelSupabaseError, which states
 *     the same fact for the same reason). Never counted: it says nothing about the answer.
 *   - Anything without a five-character SQLSTATE is not Postgres answering. A gateway 502, a
 *     proxy timeout, an auth-layer refusal: not counted.
 *   - And these SQLSTATE classes ARE Postgres answering, but answering "not now": connection
 *     exception (08), transaction rollback including serialization failure (40), insufficient
 *     resources (53), operator intervention including statement timeout (57), system error (58),
 *     and internal error (XX). A twenty-minute database incident must not reject a shift's worth
 *     of care documentation.
 */
const TRANSIENT_SQLSTATE_CLASSES = ["08", "40", "53", "57", "58", "XX"];

export function isDeterministicServerRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || !/^[0-9A-Z]{5}$/u.test(code)) return false;
  return !TRANSIENT_SQLSTATE_CLASSES.includes(code.slice(0, 2));
}

/**
 * Five, because the runner retries every five minutes: about twenty minutes of the same refusal
 * before a human is asked to look. Long enough that a deploy or a migration finishing mid-shift
 * resolves itself; short enough that the aide hears about it on the same shift they documented.
 */
export const MAX_SERVER_REFUSALS_BEFORE_REVIEW = 5;

/**
 * What a failed sync attempt should write.
 *
 * Returns the patch, so the two lanes share the decision and differ only in which store they hand
 * it to. `failedAttempts` counts refusals, not attempts: a draft that fails ten times offline and
 * once on the server has a count of one, which is the honest number.
 */
export function nextStateAfterSyncFailure<TState extends string>(
  error: unknown,
  previousFailures: number | undefined,
  rejectedState: TState,
  errorState: TState,
): { syncState: TState; failedAttempts: number } {
  if (!isDeterministicServerRefusal(error)) {
    return { syncState: errorState, failedAttempts: previousFailures ?? 0 };
  }
  const failedAttempts = (previousFailures ?? 0) + 1;
  return {
    syncState: failedAttempts >= MAX_SERVER_REFUSALS_BEFORE_REVIEW ? rejectedState : errorState,
    failedAttempts,
  };
}
