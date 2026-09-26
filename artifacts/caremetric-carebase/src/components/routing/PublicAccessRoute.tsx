import { useEffect, useState, type ComponentType } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { PUBLIC_ACCESS_FLOWS, readPublicAccessToken } from "@/lib/publicAccessToken";
import { appPath } from "@/lib/appUrl";

/** Reset guest state for a different credential, without replaying actions when its URL is scrubbed. */
export function PublicAccessRoute({ component: Component }: { component: ComponentType }) {
  // Wouter's location is relative to the configured router base, including a /train deployment.
  const [location] = useLocation();
  const search = useSearch();
  const { token } = useParams<{ token?: string }>();
  const path = location.replace(/\/$/, "");
  const flow = PUBLIC_ACCESS_FLOWS.find(candidate => candidate.storageKey
    && (path === candidate.cleanPath || path.startsWith(`${candidate.cleanPath}/`)));
  const designatedPerson = path === "/resident-portal";
  const storageKey = designatedPerson ? "carebase-resident-portal-token" : flow?.storageKey ?? null;
  const supplied = (designatedPerson ? new URLSearchParams(search).get("access") : token)?.trim() ?? "";
  const [active, setActive] = useState(() => ({
    storageKey,
    token: storageKey ? supplied || readPublicAccessToken(storageKey) : "",
    supplied: !!supplied,
    scan: 0,
  }));
  let identity = active;
  const flowChanged = active.storageKey !== storageKey;
  const tokenChanged = !!storageKey && !!supplied && active.token !== supplied;
  // A deliberate repeat scan toggles attendance; merely scrubbing its URL must never do so.
  const repeatScan = storageKey === "checkin-access-token" && !!supplied && !active.supplied;
  if (flowChanged || tokenChanged || active.supplied !== !!supplied) {
    identity = {
      storageKey,
      token: flowChanged || tokenChanged ? (storageKey ? supplied || readPublicAccessToken(storageKey) : "") : active.token,
      supplied: !!supplied,
      scan: flowChanged ? 0 : active.scan + (repeatScan ? 1 : 0),
    };
    // A render-time adjustment discards the previous page before committing the replacement.
    // An absent token on the SAME flow means URL scrubbing, so it retains the active identity.
    setActive(identity);
  }
  useEffect(() => {
    if (!storageKey || !supplied) return;
    const current = new URL(window.location.href);
    let currentPath = current.pathname;
    // Wouter decodes the pathname once (and leaves malformed escapes unchanged).
    try { currentPath = decodeURI(currentPath); } catch { /* Match the router's fallback. */ }
    const stillOnRoute = currentPath === appPath(location);
    // Revisiting the SAME guest grant preserves the page, so its initial consumer does not run
    // again. Still scrub that explicitly supplied URL, without re-running a read/sign/scan.
    // Only touch the matching current URL: a newer navigation may already have replaced it.
    if (designatedPerson) {
      if (!stillOnRoute) return;
      if (current.searchParams.get("access")?.trim() !== supplied) return;
      current.searchParams.delete("access");
      window.history.replaceState(null, "", `${current.pathname}${current.search}${current.hash}`);
    } else if (flow && stillOnRoute) {
      window.history.replaceState(null, "", `${appPath(flow.cleanPath)}${current.search}${current.hash}`);
    }
  }, [storageKey, supplied, designatedPerson, flow, location]);
  return <Component key={storageKey ? JSON.stringify([storageKey, identity.token, identity.scan]) : undefined} />;
}
