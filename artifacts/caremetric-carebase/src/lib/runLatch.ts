/**
 * Run-at-most-one-at-a-time, for work that is unsafe to overlap.
 *
 * Its own module, with no React or app imports, for two reasons. A module-level latch has to be
 * shared by callers in different components — a ref cannot do that — and keeping it dependency-free
 * means its test imports this function rather than a reproduction of it. An earlier draft of that
 * test re-implemented the latch locally and would have kept passing after this changed.
 *
 * Used by useOfflineSyncRunner: the drafts panel's manual "Sync now" and the shell-mounted
 * OfflineSyncManager's background loop both drive the same two offline lanes, which share one
 * IndexedDB database, one device key and one device registration. The runner orders those lanes so
 * a wipe in one stops the other before it can re-register the device that was just revoked;
 * overlapping runs would reintroduce that race from the outside.
 */
export function createRunLatch<T>() {
  let inFlight: Promise<T> | null = null;
  return (work: () => Promise<T>): Promise<T> => {
    // A caller arriving mid-run joins it, so its await still resolves when the work is genuinely
    // done rather than resolving early on a run it did not start.
    if (inFlight) return inFlight;
    // .finally, not .then -- a rejected run must release the latch too, or the first network
    // failure would wedge it shut and silently stop every future sync on the device. The
    // background loop retries precisely because runs fail.
    inFlight = work().finally(() => { inFlight = null; });
    return inFlight;
  };
}
