import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, upload: vi.fn(), complete: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.state)) harness.state[index] = typeof initial === "function" ? initial() : initial;
    return [harness.state[index], (value: unknown) => { harness.state[index] = value; }];
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/hooks/useResidentDocuments", () => ({ useUploadResidentDocument: () => ({ mutateAsync: harness.upload, isPending: false }) }));
vi.mock("@/hooks/useResidentComplianceItems", () => ({ useCompleteResidentComplianceItem: () => ({ mutateAsync: harness.complete, isPending: false }) }));
import { CompleteWithStateFormDialog } from "./CompleteWithStateFormDialog";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function render() {
  harness.cursor = 0;
  return nodes(CompleteWithStateFormDialog({ item: { id: "item", item_type: "medical_evaluation" },
    resident: { id: "resident", organization_id: "org", facility_id: "facility", admission_date: "2026-08-01" },
    facilityType: "PCH", existingDocumentId: "signed-document", onClose: vi.fn() }));
}
describe("completion using an already attached state form", () => {
  beforeEach(() => { harness.state = []; harness.cursor = 0; vi.clearAllMocks(); harness.complete.mockResolvedValue({}); });
  it("records the selected exam date and reuses the signed document", async () => {
    const dateInput = render().find(node => node.props.id === "compliance-completed-on")!;
    (dateInput.props.onChange as (event: unknown) => void)({ target: { value: "2026-08-15" } });
    const submit = render().find(node => node.props.children === "Mark Complete")!;
    expect(submit.props.disabled).toBe(false);
    await (submit.props.onClick as () => Promise<void>)();
    expect(harness.upload).not.toHaveBeenCalled();
    expect(harness.complete).toHaveBeenCalledWith(expect.objectContaining({ documentId: "signed-document", completedOn: "2026-08-15" }));
  });
  it("cannot submit an empty date even with a valid existing document", () => {
    const dateInput = render().find(node => node.props.id === "compliance-completed-on")!;
    (dateInput.props.onChange as (event: unknown) => void)({ target: { value: "" } });
    expect(render().find(node => node.props.children === "Mark Complete")?.props.disabled).toBe(true);
  });
});
