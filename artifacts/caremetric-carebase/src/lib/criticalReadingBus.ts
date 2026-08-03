/**
 * Where a sync run publishes critical readings, so that every caller surfaces them.
 *
 * Codex review finding. The shell-mounted OfflineSyncManager copied `result.critical` into its own
 * state, but the drafts panel's manual "Sync now" discarded the result -- and because the latch
 * makes a manual click during a background backoff join the SAME run, the manager neither started
 * nor observed it. A vital sign the server flagged critical could therefore be charted and produce
 * only a generic "1 item recorded" toast, which is the exact warning the panel used to render.
 *
 * Publishing from the runner rather than from each caller makes "every invocation surfaces them"
 * true by construction instead of by every future caller remembering to.
 *
 * A three-line store rather than React context: the publisher is a plain async function outside the
 * component tree, and the subscriber is one component in the shell.
 */
export interface CriticalReading {
  observationId: string;
  residentId: string;
  residentLabel: string;
}

type Listener = (readings: CriticalReading[]) => void;

const listeners = new Set<Listener>();
let latest: CriticalReading[] = [];

export function publishCriticalReadings(readings: CriticalReading[]): void {
  if (readings.length === 0) return;
  latest = readings;
  for (const listener of listeners) listener(readings);
}

/** Returns an unsubscribe. Replays the latest batch so a late subscriber does not miss one. */
export function subscribeToCriticalReadings(listener: Listener): () => void {
  listeners.add(listener);
  if (latest.length > 0) listener(latest);
  return () => { listeners.delete(listener); };
}

/** The shell clears these once a human has seen them. */
export function clearCriticalReadings(): void {
  latest = [];
}
