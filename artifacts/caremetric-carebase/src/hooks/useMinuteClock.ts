import { useEffect, useState } from "react";

/**
 * A `Date` that advances once a minute, for a deadline the page is watching.
 *
 * BACKLOG.md I23. IncidentFollowThroughSection derived its stage statuses from `new Date()` at
 * render time and nothing re-rendered it, so a deadline that passed while the page was open kept
 * reading as pending until the query happened to refetch or the user clicked something. The
 * shortest of those deadlines is the two-hour reportable-incident notification in 55 Pa. Code, and
 * "the screen was still showing it as in time" is not an answer a facility can give the state.
 *
 * Minute resolution rather than second: every deadline this drives is measured in hours, a
 * per-second re-render of a page this size buys nothing, and the interval is aligned to the next
 * whole minute so the flip happens when the clock on the wall says it does rather than up to
 * fifty-nine seconds later.
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => setNow(new Date()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== undefined) clearInterval(intervalId);
    };
  }, []);

  return now;
}
