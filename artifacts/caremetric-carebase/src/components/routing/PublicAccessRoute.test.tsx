import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  path: "", search: "", token: undefined as string | undefined,
  active: undefined as unknown,
  effect: undefined as (() => void) | undefined, base: "",
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void) => { h.effect = effect; },
  useState: (initialize: () => unknown) => {
    if (h.active === undefined) h.active = initialize();
    return [h.active, (value: unknown) => { h.active = value; }];
  },
}));
vi.mock("wouter", () => ({ useLocation: () => [h.path], useParams: () => ({ token: h.token }), useSearch: () => h.search }));
vi.mock("@/lib/appUrl", () => ({ appPath: (path: string) => `${h.base}${path}` }));
import { PublicAccessRoute } from "./PublicAccessRoute";
import { PUBLIC_ACCESS_FLOWS, clearStoredPublicAccessToken, storePublicAccessToken } from "@/lib/publicAccessToken";
const Page = () => null;
const flows = PUBLIC_ACCESS_FLOWS.filter(flow => flow.storageKey);
function render(path: string, token?: string, search = "") {
  h.path = path; h.token = token; h.search = search;
  return PublicAccessRoute({ component: Page });
}
beforeEach(() => {
  h.active = undefined;
  h.effect = undefined; h.base = "";
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  for (const flow of flows) clearStoredPublicAccessToken(flow.storageKey);
  clearStoredPublicAccessToken("carebase-resident-portal-token");
});
afterEach(() => vi.unstubAllGlobals());

it.each(flows)("isolates $name grants while preserving the scrubbed route", flow => {
  const first = render(`${flow.cleanPath}/a`, "a");
  const scrubbed = render(flow.cleanPath);
  expect(scrubbed.key).toBe(first.key);
  expect(render(`${flow.cleanPath}/`, undefined, "view=history").key).toBe(first.key);
  if (flow.cleanPath !== "/checkin") expect(render(`${flow.cleanPath}/a`, "a").key).toBe(first.key);
  const second = render(`${flow.cleanPath}/b`, "b");
  expect(second.type).toBe(first.type);
  expect(second.key).not.toBe(first.key);
  expect(render(flow.cleanPath).key).toBe(second.key);
  const back = render(`${flow.cleanPath}/a`, "a");
  if (flow.cleanPath !== "/checkin") expect(back.key).toBe(first.key);
});
it("replays an explicit same-QR scan but never its automatic scrub", () => {
  const first = render("/checkin/a", "a");
  expect(render("/checkin").key).toBe(first.key);
  const rescan = render("/checkin/a", "a");
  expect(rescan.key).not.toBe(first.key);
  expect(render("/checkin").key).toBe(rescan.key);
  expect(render("/checkin", undefined, "mode=history").key).toBe(rescan.key);
});
it("tracks designated-person query credentials without remounting when access is scrubbed", () => {
  const first = render("/resident-portal", undefined, "access=first&view=messages");
  expect(render("/resident-portal", undefined, "view=documents").key).toBe(first.key);
  const second = render("/resident-portal", undefined, "access=second&view=messages");
  expect(second.key).not.toBe(first.key);
  expect(render("/resident-portal").key).toBe(second.key);
});
it("restores a clean-path credential and preserves the denial view after storage is cleared", () => {
  const flow = flows[0]; storePublicAccessToken(flow.storageKey!, "stored-grant");
  const initial = render(flow.cleanPath);
  clearStoredPublicAccessToken(flow.storageKey);
  expect(render(flow.cleanPath).key).toBe(initial.key);
  expect(render(`${flow.cleanPath}/new-grant`, "new-grant").key).not.toBe(initial.key);
});
it("retains the identity across scrubbing when browser storage is unavailable", () => {
  vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("storage blocked"); } });
  const first = render("/evidence-access/a", "a");
  expect(render("/evidence-access").key).toBe(first.key);
});
it("separates flows even when their opaque credentials have the same value", () => {
  const first = render("/evidence-access/a", "a");
  expect(render("/move-in-access/a", "a").key).not.toBe(first.key);
});
it("leaves other public routes alone and restores the stored grant on a later visit", () => {
  render("/evidence-access/a", "a");
  expect(render("/report-safety").key).toBeNull();
  storePublicAccessToken("carebase-evidence-room-token", "replacement");
  const restored = render("/evidence-access");
  expect(restored.key).toBe(render("/evidence-access/replacement", "replacement").key);
});
it("does not let an old query-token effect scrub a different current route", () => {
  render("/resident-portal", undefined, "access=same");
  const effect = h.effect!;
  const replaceState = vi.fn();
  vi.stubGlobal("window", { location: { href: "https://app.test/other?access=same" }, history: { replaceState } });
  effect();
  expect(replaceState).not.toHaveBeenCalled();
});
it.each(["", "/train"])("scrubs a matching query grant within the %s deployment base", base => {
  h.base = base;
  render("/resident-portal", undefined, "access=same&tab=messages");
  const replaceState = vi.fn();
  vi.stubGlobal("window", { location: { href: `https://app.test${base}/resident-portal?access=same&tab=messages#draft` }, history: { replaceState } });
  h.effect!();
  expect(replaceState).toHaveBeenCalledWith(null, "", `${base}/resident-portal?tab=messages#draft`);
});
it("matches Wouter's decoded path when a repeated grant is percent-escaped", () => {
  render("/evidence-access/a", "a");
  const replaceState = vi.fn();
  vi.stubGlobal("window", { location: { href: "https://app.test/evidence-access/%61?view=list#item" }, history: { replaceState } });
  h.effect!();
  expect(replaceState).toHaveBeenCalledWith(null, "", "/evidence-access?view=list#item");
});
