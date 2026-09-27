import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  id: "report-a", user: { id: "reviewer-a", organizationId: "org-a", role: "org_admin" },
  state: [] as unknown[], cursor: 0, key: undefined as string | null | undefined,
  open: vi.fn(), reveal: vi.fn(), toast: vi.fn(),
}));
// Match the existing component event harness, keeping state setters bound to the
// instance that created them so delayed callbacks exercise the unmounted instance.
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useId: () => "report",
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const state = h.state;
    const index = h.cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
  },
}));
vi.mock("wouter", () => ({ useParams: () => ({ id: h.id }), Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [] }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [] }) }));
vi.mock("@/pages/app/ConfidentialIncidents", () => ({ IntakePill: "span" }));
vi.mock("@/hooks/useConfidentialIncidents", () => ({
  useGetConfidentialIntake: (id: string) => ({ data: { id, intake_number: id, status: "submitted", severity: "low", public_summary: `Summary ${id}`, reported_at: "2026-09-26", reporter_mode: "identified" } }),
  useListIntakeAccessEvents: () => ({ data: [] }),
  useOpenIntakeDetails: () => ({ mutate: h.open }),
  useRevealReporterIdentity: () => ({ mutate: h.reveal }),
  useSetIntakeStatus: () => ({ mutate: vi.fn() }),
}));

import ConfidentialIncidentDetail from "./ConfidentialIncidentDetail";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function content(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(content).join("");
  return value && typeof value === "object" && "props" in value ? content((value as Node).props.children as ReactNode) : "";
}
function render() {
  h.cursor = 0;
  const boundary = ConfidentialIncidentDetail();
  if (typeof boundary.type !== "function") return boundary;
  if (h.key !== boundary.key) { h.state = []; h.key = boundary.key; }
  h.cursor = 0;
  return (boundary.type as (props: Record<string, unknown>) => ReactElement)(boundary.props);
}
function fill(suffix: string, value: string) {
  const input = nodes(render()).find(node => node.props.id === `report-${suffix}`)!;
  (input.props.onChange as (event: unknown) => void)({ target: { value } });
}
function click(label: string) {
  const button = nodes(render()).find(node => typeof node.props.onClick === "function" && content(node.props.children as ReactNode).trim() === label)!;
  expect(button.props.disabled).toBeFalsy();
  (button.props.onClick as () => void)();
}
function requestProtectedData() {
  fill("purpose-of-review", "Investigate this report"); click("Open protected details");
  fill("purpose-of-reveal", "Follow up with reporter"); click("Reveal reporter identity");
  expect(h.open.mock.calls.at(-1)![0].intakeId).toBe(h.id);
  expect(h.reveal.mock.calls.at(-1)![0].intakeId).toBe(h.id);
  return () => {
    h.open.mock.calls.at(-1)![1].onSuccess({ narrative: "Private narrative A" });
    h.reveal.mock.calls.at(-1)![1].onSuccess({ identityOnFile: true, reporterName: "Reporter A", reporterEmail: "reporter-a@example.test", consentToContact: true });
  };
}
function expectLocked() {
  const view = render();
  expect(content(view)).not.toContain("Private narrative A");
  expect(content(view)).not.toContain("reporter-a@example.test");
  expect(content(view)).toContain("Open protected details");
  expect(content(view)).toContain("Reveal reporter identity");
  for (const suffix of ["purpose-of-review", "purpose-of-reveal"]) {
    expect(nodes(view).find(node => node.props.id === `report-${suffix}`)!.props.value).toBe("");
  }
}
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.cursor = 0; h.key = undefined;
  h.id = "report-a"; h.user = { id: "reviewer-a", organizationId: "org-a", role: "org_admin" };
});
describe("confidential report protected state boundary", () => {
  it("relocks protected narrative and identity when the report changes", () => {
    requestProtectedData()();
    expect(content(render())).toContain("Private narrative A");
    expect(content(render())).toContain("reporter-a@example.test");
    h.id = "report-b";
    expectLocked();
    expect(content(render())).toContain("Summary report-b");
    expect(h.open).toHaveBeenCalledOnce(); expect(h.reveal).toHaveBeenCalledOnce();
  });
  it("cannot apply an old report's late protected responses to the replacement report", () => {
    const resolve = requestProtectedData();
    h.id = "report-b"; render();
    resolve();
    expectLocked();
  });
  it("requires new audited reads after the reviewer changes", () => {
    requestProtectedData()();
    h.user = { ...h.user, id: "reviewer-b" };
    expectLocked();
  });
});
