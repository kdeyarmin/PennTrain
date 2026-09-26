import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, rows: [] as unknown[], role: "org_admin" }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const index = harness.cursor++;
  if (!(index in harness.state)) harness.state[index] = typeof initial === "function" ? initial() : initial;
  return [harness.state[index], (value: unknown) => { harness.state[index] = typeof value === "function" ? value(harness.state[index]) : value; }];
} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: harness.role } }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useFacilitySiteCompliance", () => ({ useFacilitySiteReviews: () => ({ data: harness.rows }), useFacilitySitePolicy: vi.fn(), useSaveFacilitySitePolicy: vi.fn(), useAddFacilitySiteReview: vi.fn(), useSiteSupportPlans: vi.fn(), useSiteDrillRotation: vi.fn() }));
import { FacilitySiteCompliance } from "./FacilitySiteCompliance";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}
const record = { id: "prior", review_type: "fire_approval", event_kind: "restricted", occurred_at: "2026-01-01T15:00:00Z", next_review_on: null, details: {}, evidence: "Original restriction evidence", supersedes_id: null };
function render() { harness.cursor = 0; return nodes(FacilitySiteCompliance({ organizationId: "organization", facilityId: "facility", facilityType: "PCH" })); }
describe("site lifecycle review display", () => {
  beforeEach(() => { harness.state = []; harness.cursor = 0; harness.rows = [record]; harness.role = "org_admin"; });
  it("opens an append-only follow-up carrying the original record, not an update form", () => {
    const button = render().find((node) => node.props.children === "Append follow-up / correction")!;
    (button.props.onClick as () => void)();
    const dialog = render().find((node) => node.props.previous === record);
    expect(dialog).toBeDefined();
    expect(render().some((node) => node.props.children === "Delete" || node.props.children === "Edit")).toBe(false);
  });
  it("keeps superseded records available in history and provides no writes to an auditor", () => {
    harness.rows = [record, { ...record, id: "next", supersedes_id: "prior", evidence: "Follow-up restriction evidence" }];
    harness.role = "auditor";
    let tree = render();
    expect(tree.some((node) => node.props.children === record.evidence)).toBe(false);
    expect(tree.some((node) => node.props.children === "Add review" || node.props.children === "Append follow-up / correction")).toBe(false);
    const toggle = tree.find((node) => node.props.type === "checkbox")!;
    (toggle.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    tree = render();
    expect(tree.some((node) => node.props.children === record.evidence)).toBe(true);
  });
});
