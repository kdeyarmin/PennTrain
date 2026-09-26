import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, save: vi.fn(), rows: [] as unknown[] }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useId: () => "regulatory-form",
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.state)) harness.state[index] = typeof initial === "function" ? initial() : initial;
    return [harness.state[index], (value: unknown) => {
      harness.state[index] = typeof value === "function" ? value(harness.state[index]) : value;
    }];
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useResidentRegulatoryActions", () => ({
  useResidentRegulatoryActions: () => ({ data: harness.rows, isLoading: false, isError: false }),
  useSaveResidentRegulatoryAction: () => ({ mutate: harness.save, isPending: false }),
}));
import { RegulatoryActions } from "./RegulatoryActions";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function render() {
  harness.cursor = 0;
  return nodes(RegulatoryActions({ organizationId: "organization", facilityId: "facility", facilityType: "ALR" }));
}
function click(label: string) {
  const button = render().find(node => node.props.children === label && node.props.onClick);
  expect(button, label).toBeDefined();
  (button!.props.onClick as () => void)();
}
function enter(key: string, value: string) {
  const input = render().find(node => node.props.id === `regulatory-form-${key}` && node.props.onChange)!;
  (input.props.onChange as (event: unknown) => void)({ target: { value } });
}
const completed = {
  id: "completed-record", organization_id: "organization", facility_id: "facility", resident_id: "resident",
  action_type: "discharge_notice", recipient_role: "designated_person", recipient_name: "Original recipient",
  anchor_at: "2026-04-01T14:00:00Z", due_at: "2026-03-02T15:00:00Z", completed_at: "2026-03-01T15:00:00Z",
  reason: "Original discharge reason", destination: "Original destination", evidence: "Original written notice", status: "completed",
  exception_basis: null, details: { language: "English", ombudsman_contacts: "Original contacts", rights_and_appeal: "Original rights", aging_in_place_attempts: "Original accommodation evidence" },
};

describe("completed regulatory notice evidence", () => {
  beforeEach(() => { harness.state = []; harness.cursor = 0; harness.rows = [completed]; harness.save.mockReset(); });

  it("opens every completed field read-only and exposes no save action", () => {
    click("View completed record");
    const tree = render();
    const fields = tree.filter(node => typeof node.props.onChange === "function");
    expect(fields.length).toBeGreaterThan(8);
    for (const field of fields) expect(field.props.disabled, String(field.props.id)).toBe(true);
    for (const select of tree.filter(node => node.props.onValueChange)) expect(select.props.disabled).toBe(true);
    expect(tree.some(node => node.props.children === "Save record")).toBe(false);
    expect(harness.save).not.toHaveBeenCalled();
  });

  it("appends one correction for the original resident and recipient from the facility view", () => {
    click("Add correction");
    enter("reason", "Correction: the receiving address was transcribed incorrectly");
    enter("destination", "Corrected destination");
    const status = render().find(node => node.props.value === "pending" && node.props.onValueChange)!;
    (status.props.onValueChange as (value: string) => void)("completed");
    enter("completed", "2026-03-01T10:00");
    enter("evidence", "Original notice and correction explanation retained together");
    click("Save record");
    expect(harness.save).toHaveBeenCalledOnce();
    const payload = harness.save.mock.calls[0][0];
    expect(payload).not.toHaveProperty("id");
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0]).toMatchObject({ resident_id: "resident", recipient_role: "designated_person",
      recipient_name: "Original recipient", destination: "Corrected destination", status: "completed",
      details: { corrects_action_id: "completed-record" } });
    expect(completed.destination).toBe("Original destination");
    expect(completed.evidence).toBe("Original written notice");
  });
});
