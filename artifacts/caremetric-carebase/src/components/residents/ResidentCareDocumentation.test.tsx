import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, role: "org_admin",
  notes: [] as Record<string, unknown>[],
  save: vi.fn(), sign: vi.fn(), toast: vi.fn(), refetch: vi.fn(),
}));

// Run the actual component handlers and next render, following Reports.scope.test.tsx's harness.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "clinical-care-test",
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.state)) harness.state[index] = typeof initial === "function" ? initial() : initial;
    return [harness.state[index], (next: unknown) => {
      harness.state[index] = typeof next === "function" ? next(harness.state[index]) : next;
    }];
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: harness.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/hooks/useResidentClinicalCare", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useResidentClinicalCare: () => ({ data: { notes: harness.notes, carePlans: [], goals: [], assessments: [] }, isLoading: false, refetch: harness.refetch }),
    useSaveClinicalProgressNote: () => ({ mutateAsync: harness.save, isPending: false }),
    useSignClinicalProgressNote: () => ({ mutateAsync: harness.sign, isPending: false }),
    useAmendClinicalProgressNote: mutation, useRetractClinicalProgressNote: mutation,
    useFinalizeClinicalAssessment: mutation, useRecordClinicalAssessment: mutation,
    useSaveCarePlanGoal: mutation, useSaveClinicalCarePlan: mutation,
  };
});

import { ResidentCareDocumentation } from "./ResidentCareDocumentation";

type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return node && typeof node === "object" && "props" in node
    ? nodeText((node as Node).props.children as ReactNode) : "";
}
function render(canChart = true) {
  harness.cursor = 0;
  return nodes(ResidentCareDocumentation({ residentId: "resident-1", canChart }));
}
function button(label: string, canChart = true) {
  return render(canChart).find((node) => typeof node.props.onClick === "function" && nodeText(node.props.children as ReactNode) === label);
}
function click(label: string) {
  const target = button(label);
  expect(target, label).toBeDefined();
  expect(target!.props.disabled, label).not.toBe(true);
  (target!.props.onClick as () => void)();
}
function composer() {
  return render().find((node) => node.props.placeholder === "Document the observation or care provided…")!;
}
function typeNote(body: string) {
  (composer().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: body } });
}
function note(status = "draft") {
  return {
    id: "note-1", resident_id: "resident-1", note_type: "nursing", body: "Original draft", status,
    authored_at: "2026-09-07T12:00:00Z", author_name: "Test caregiver", signed_at: null,
    care_plan_id: "plan-1", change_event_id: "event-1",
  };
}

beforeEach(() => {
  harness.state = []; harness.cursor = 0; harness.role = "org_admin"; harness.notes = [];
  harness.save.mockReset().mockResolvedValue("note-1");
  harness.sign.mockReset().mockResolvedValue(undefined);
  harness.toast.mockReset(); harness.refetch.mockReset().mockResolvedValue(undefined);
});

describe("clinical progress-note draft completion", () => {
  it("offers Edit and Sign for saved drafts, and neither for signed or read-only notes", () => {
    harness.notes = [note()];
    expect(button("Edit draft")).toBeDefined();
    expect(button("Sign note")).toBeDefined();
    expect(button("Edit draft", false)).toBeUndefined();
    expect(button("Sign note", false)).toBeUndefined();
    harness.notes = [note("signed")];
    expect(button("Edit draft")).toBeUndefined();
    expect(button("Sign note")).toBeUndefined();
    expect(button("Amend")).toBeDefined();
  });

  it("updates the existing draft and preserves its original time and clinical links", async () => {
    harness.notes = [note()];
    click("Edit draft");
    expect(composer().props.value).toBe("Original draft");
    typeNote("Reviewed draft");
    click("Save draft");
    await vi.waitFor(() => expect(harness.save).toHaveBeenCalledWith({
      residentId: "resident-1", noteId: "note-1", noteType: "nursing", body: "Reviewed draft",
      authoredAt: "2026-09-07T12:00:00Z", carePlanId: "plan-1", changeEventId: "event-1",
    }));
    expect(harness.sign).not.toHaveBeenCalled();
    expect(composer().props.value).toBe("");
  });

  it("recovers a failed signature using the saved note instead of creating a duplicate", async () => {
    harness.sign.mockRejectedValueOnce(new Error("Connection interrupted"));
    typeNote("Care provided");
    click("Save & sign");
    await vi.waitFor(() => expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Draft saved; signature could not be completed",
    })));
    expect(composer().props.value).toBe("");
    expect(harness.refetch).toHaveBeenCalledTimes(1);
    harness.notes = [note()];
    click("Sign note");
    await vi.waitFor(() => expect(harness.sign).toHaveBeenCalledTimes(2));
    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.sign).toHaveBeenNthCalledWith(2, { residentId: "resident-1", noteId: "note-1" });
  });

  it("keeps unsaved text and does not attempt signing when draft creation fails", async () => {
    harness.save.mockRejectedValueOnce(new Error("Offline"));
    typeNote("Care provided");
    click("Save & sign");
    await vi.waitFor(() => expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Note could not be saved" })));
    expect(composer().props.value).toBe("Care provided");
    expect(harness.sign).not.toHaveBeenCalled();
  });

  it("does not overwrite unsaved charting when another draft is selected", () => {
    harness.notes = [note()];
    typeNote("Unsaved new note");
    expect(button("Edit draft")!.props.disabled).toBe(true);
  });

  it("offers manager-only retraction according to the server's clinical permission", () => {
    harness.notes = [note("signed")];
    expect(button("Entered in error")).toBeDefined();
    harness.role = "employee";
    expect(button("Entered in error")).toBeUndefined();
    expect(button("Amend")).toBeDefined();
  });
});
