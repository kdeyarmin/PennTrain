import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useUnsyncedServiceDraftEntries } from "@/hooks/useOfflineServiceDrafts";
import { useUnsyncedObservationDraftEntries } from "@/hooks/useOfflineObservationDrafts";
import { UNRESOLVED_DRAFT_STATES } from "@/lib/offlineServiceDraftSafety";
import { UNRESOLVED_OBSERVATION_DRAFT_STATES } from "@/lib/offlineObservationDraftSafety";
import { useRunAllOfflineSyncs } from "@/hooks/useOfflineSyncRunner";
import {
  clearCriticalReadings, subscribeToCriticalReadings, type CriticalReading,
} from "@/lib/criticalReadingBus";

/**
 * The offline sync loop, mounted once in the signed-in shell (BACKLOG.md open question 7a).
 *
 * WHY THIS IS NOT A COMPONENT ON A FEW PAGES ANY MORE. The panel that used to own this is mounted
 * on Floor, MyResidents and ChangeOfConditionDetail. A caregiver who takes a reading on
 * /me/residents/:id and sits there is on none of them, which is exactly where a reading is taken --
 * so nobody was watching connectivity at the one moment it mattered, and the offline toast's
 * promise that it "will sync when you're back online" was true only after a navigation.
 *
 * WHY A TIMER, WHEN THE PREVIOUS CODE DELIBERATELY REFUSED ONE. That refusal was reasonable for
 * the signal it had: `online` fires exactly when a backlog can first make progress, so a timer
 * looked like pure noise. The flaw is in the signal, not the reasoning. Every failure the offline
 * fallback exists for -- a LAN link with no route out, a bad DNS resolver, a captive portal,
 * Supabase itself down -- leaves `navigator.onLine` reading true throughout BOTH the failure and
 * the recovery. The event never fires, so "only on the online event" means "never" for precisely
 * the cases that produced the draft.
 *
 * There is no reachability probe here on purpose. The honest test of whether the server is
 * reachable is the sync itself, and this store already treats a network-level failure as a
 * keep-and-retry rather than a loss -- so the retry IS the probe, and a separate health endpoint
 * would be a second thing to keep true.
 *
 * The loop is bounded by there being work: it stops as soon as the backlog empties, so an ordinary
 * shift with nothing queued costs nothing beyond the draft-entry queries the panel already runs.
 */

// Backoff for the retry loop. Starts responsive, because the common case is a brief dead spot and
// the draft is care documentation nobody else can see yet; settles to five minutes so a genuinely
// long outage is not a request every half minute for an hour.
const RETRY_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000];

export function OfflineSyncManager() {
  const { user } = useAuth();
  const { run } = useRunAllOfflineSyncs();
  const serviceEntries = useUnsyncedServiceDraftEntries();
  const observationEntries = useUnsyncedObservationDraftEntries();
  const [critical, setCritical] = useState<CriticalReading[]>([]);

  // Both stores are employee-scoped (register_offline_service_device refuses any other role), so
  // for everyone else this is a no-op that never opens IndexedDB.
  const enabled = user?.role === "employee";

  const pendingCount =
    (serviceEntries.data ?? []).filter((entry) => (UNRESOLVED_DRAFT_STATES as string[]).includes(entry.syncState)).length
    + (observationEntries.data ?? []).filter((entry) => (UNRESOLVED_OBSERVATION_DRAFT_STATES as string[]).includes(entry.syncState)).length;
  const settled = serviceEntries.isSuccess && observationEntries.isSuccess;

  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards the immediate catch-up below to one run per backlog episode. Reset when the backlog
  // drains, in the loop effect.
  const caughtUpRef = useRef(false);

  const runOnce = useCallback(async () => {
    const result = await run();
    // Progress means the connection came back; drop to the fast interval so a partially-drained
    // backlog finishes quickly rather than waiting out an escalation earned while offline.
    if (result.appliedAny || result.idle) attemptRef.current = 0;
    else attemptRef.current = Math.min(attemptRef.current + 1, RETRY_BACKOFF_MS.length - 1);
    // Critical readings arrive via the bus below rather than from this result, so a run STARTED
    // elsewhere -- the panel's manual button, which the latch may have joined to this very run --
    // still reaches the alert.
  }, [run]);

  useEffect(() => subscribeToCriticalReadings(setCritical), []);

  // The retry loop. Re-armed from scratch whenever the backlog size changes, so draining it stops
  // the timer rather than leaving one running against an empty queue.
  useEffect(() => {
    if (!enabled || !settled || pendingCount === 0) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      attemptRef.current = 0;
      // Copilot review finding: without this reset, caughtUpRef latches true on the session's FIRST
      // backlog and never clears -- so every later draft in that session skips the immediate
      // catch-up and waits out a 30s backoff tick instead, which is precisely the delay the
      // catch-up exists to avoid. Reset here so it means "once per backlog episode" rather than
      // "once per session".
      caughtUpRef.current = false;
      return;
    }
    let cancelled = false;
    const arm = () => {
      timerRef.current = setTimeout(() => {
        if (cancelled) return;
        void runOnce().finally(() => { if (!cancelled) arm(); });
      }, RETRY_BACKOFF_MS[attemptRef.current]);
    };
    arm();
    return () => {
      cancelled = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [enabled, settled, pendingCount, runOnce]);

  // Catch up once as soon as the shell knows there is a backlog -- the loop above only fires after
  // its first interval, and a caregiver returning to a reachable network should not wait 30s.
  useEffect(() => {
    if (!enabled || !settled || pendingCount === 0 || caughtUpRef.current) return;
    caughtUpRef.current = true;
    void runOnce();
  }, [enabled, settled, pendingCount, runOnce]);

  // Still worth listening for: when it does fire it is the earliest possible signal, and waiting
  // out a backoff interval after a real reconnect would be a worse experience than before.
  useEffect(() => {
    if (!enabled) return;
    const handleOnline = () => { attemptRef.current = 0; void runOnce(); };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [enabled, runOnce]);

  if (critical.length === 0) return null;

  // Kept in the shell rather than in the drafts panel, and that move is part of the fix rather
  // than tidying. A vital sign the server flagged critical was charted without anyone watching --
  // the caregiver took it offline, possibly hours ago, and the chart's own re-check dialog never
  // ran. Leaving this warning on three pages while the sync that raises it now runs on all of them
  // would mean the sync could chart a critical reading and say nothing at all.
  return (
    <div className="border-b border-destructive/30 bg-destructive/10 p-4" role="alert">
      <div className="mx-auto flex max-w-7xl items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-destructive">
            {critical.length === 1
              ? "A reading just synced is outside the critical range"
              : `${critical.length} readings just synced are outside the critical range`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            These were taken offline and charted when this device reconnected. Re-check the resident
            and escalate if the reading stands.
          </p>
          <ul className="mt-3 space-y-2">
            {critical.map((reading) => (
              <li key={reading.observationId} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{reading.residentLabel}</span>
                <Button asChild size="sm" variant="destructive" className="h-9">
                  <Link href={`/me/residents/${reading.residentId}`}>Open chart</Link>
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label="Dismiss critical reading warning"
          onClick={() => { clearCriticalReadings(); setCritical([]); }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
