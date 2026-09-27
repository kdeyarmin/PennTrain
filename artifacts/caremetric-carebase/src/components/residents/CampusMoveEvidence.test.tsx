import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kinds = ["medical_evaluation", "initial_assessment_15day", "support_plan_30day"];
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, upload: vi.fn(), rpc: vi.fn(), toast: vi.fn(), invalidate: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }];
  },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useResidentDocuments", () => ({ useUploadResidentDocument: () => ({ mutateAsync: h.upload }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [
  { id: "receiving-facility", campus_identifier: "campus" }, { id: "source-facility", campus_identifier: "campus" },
] }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: () => ({ data: ["source", "other-source"].map(id => ({
  id, facility_id: "source-facility", discharge_date: "2026-09-26", first_name: "Pat", last_name: "Example", date_of_birth: "1940-01-01",
})) }) }));
vi.mock("@/hooks/useResidentComplianceItems", () => ({ useListResidentComplianceItems: (residentId: string) => ({ data:
  residentId === "receiving" ? ["medical_evaluation", "initial_assessment_15day", "support_plan_30day"].map(item_type => ({ id: `target-${item_type}`, item_type, completed_date: null }))
    : residentId ? ["medical_evaluation", "initial_assessment_15day", "support_plan_30day", "support_plan_quarterly_review"].map(item_type => ({
      id: `source-${item_type}`, item_type, completed_date: item_type === "support_plan_quarterly_review" ? "2026-09-20" : "2026-08-01", status: "compliant", created_at: "2026-09-20T00:00:00Z",
    })) : [],
}) }));
import { CampusMoveEvidence } from "./CampusMoveEvidence";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function render(facilityType = "ALR") {
  h.cursor = 0;
  return nodes(CampusMoveEvidence({ resident: { id: "receiving", organization_id: "org", facility_id: "receiving-facility", admission_date: "2026-09-26", first_name: "Pat", last_name: "Example", date_of_birth: "1940-01-01" }, facilityType, canManage: true }));
}
function choice(id: string, value: string, facilityType = "ALR") {
  const select = render(facilityType).find(node => typeof node.props.onValueChange === "function" && nodes(node).some(child => child.props.id === id))!;
  expect(select).toBeDefined();
  (select.props.onValueChange as (value: string) => void)(value);
}
function change(id: string, value: unknown, facilityType = "ALR") {
  const input = render(facilityType).find(node => node.props.id === id)!;
  expect(input).toBeDefined();
  (input.props.onChange as (event: unknown) => void)({ target: value });
}
function uploadFile(id: string, facilityType = "ALR") { change(id, { files: [new File(["signed"], `${id}.pdf`, { type: "application/pdf" })] }, facilityType); }
function prepare(facilityType = "ALR") {
  choice("campus-source", "source", facilityType);
  for (const kind of kinds) { choice(`campus-${kind}`, `source-${kind}`, facilityType); uploadFile(`campus-file-${kind}`, facilityType); }
  uploadFile("campus-addendum", facilityType);
  if (facilityType === "ALR") uploadFile("campus-quarterly-review", facilityType);
}
function reviewed(kind: string, facilityType = "ALR") {
  choice(`campus-format-${kind}`, "equivalent", facilityType);
  change(`campus-reviewer-${kind}`, { value: "Review Nurse" }, facilityType);
  change(`campus-reference-${kind}`, { value: "Signed DHS field comparison page 4" }, facilityType);
  const checkbox = render(facilityType).find(node => node.props.id === `campus-confirm-${kind}`)!;
  (checkbox.props.onCheckedChange as (checked: boolean) => void)(true);
}
function submit(facilityType = "ALR") { return render(facilityType).find(node => node.props.children === "Carry campus documents")!; }
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.cursor = 0;
  h.upload.mockImplementation(async () => ({ id: `doc-${h.upload.mock.calls.length}` }));
  h.rpc.mockResolvedValue({ error: null }); h.invalidate.mockResolvedValue(undefined);
});

describe("campus evidence form provenance", () => {
  it("requires an explicit form format and complete content review before any uploads", async () => {
    prepare();
    expect(submit().props.disabled).toBe(true);
    choice("campus-format-initial_assessment_15day", "equivalent");
    expect(submit().props.disabled).toBe(true);
    await (submit().props.onClick as () => Promise<void>)();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("keeps the DME official and atomically hands the quarterly equivalent review to the carry RPC", async () => {
    prepare();
    for (const kind of ["initial_assessment_15day", "support_plan_30day", "support_plan_quarterly_review"]) reviewed(kind);
    expect(render().some(node => node.props.id === "campus-format-medical_evaluation")).toBe(false);
    expect(submit().props.disabled).toBe(false);
    await (submit().props.onClick as () => Promise<void>)();
    const inputs = h.upload.mock.calls.map(([input]) => input);
    expect(inputs).toHaveLength(5);
    expect(inputs[0]).toMatchObject({ isStateForm: true, complianceItemId: "target-medical_evaluation" });
    for (const index of [1, 2]) expect(inputs[index]).toMatchObject({ isStateForm: false, equivalentFormReview: { all_required_information: true, reviewer_name: "Review Nurse", review_reference: "Signed DHS field comparison page 4" } });
    expect(inputs[1].complianceItemId).toBe("target-initial_assessment_15day");
    expect(inputs[2].complianceItemId).toBe("target-support_plan_30day");
    expect(inputs[3]).toMatchObject({ isStateForm: false, residentId: "receiving", facilityId: "receiving-facility" });
    expect(inputs[3]).not.toHaveProperty("complianceItemId");
    expect(inputs[3]).not.toHaveProperty("equivalentFormReview");
    expect(h.rpc).toHaveBeenCalledWith("carry_campus_resident_evidence", expect.objectContaining({ p_resident_id: "receiving", p_source_resident_id: "source", p_evidence: expect.objectContaining({ support_plan_quarterly_review: { source_item_id: "source-support_plan_quarterly_review", document_id: "doc-4", equivalent_form_review: { all_required_information: true, reviewer_name: "Review Nurse", review_reference: "Signed DHS field comparison page 4" } } }) }));
  });

  it("carries official signed forms without equivalent metadata", async () => {
    prepare();
    for (const kind of ["initial_assessment_15day", "support_plan_30day", "support_plan_quarterly_review"]) choice(`campus-format-${kind}`, "official");
    await (submit().props.onClick as () => Promise<void>)();
    for (const [input] of h.upload.mock.calls.slice(0, 4)) {
      expect(input.isStateForm).toBe(true);
      expect(input.stateFormSourceLabel).toBeTruthy();
      expect(input).not.toHaveProperty("equivalentFormReview");
    }
    expect(h.rpc.mock.calls[0][1].p_evidence.support_plan_quarterly_review).not.toHaveProperty("equivalent_form_review");
  });

  it("does not impose ALF quarterly evidence on a receiving PCH", async () => {
    prepare("PCH");
    for (const kind of ["initial_assessment_15day", "support_plan_30day"]) reviewed(kind, "PCH");
    expect(render("PCH").some(node => node.props.id === "campus-quarterly-review")).toBe(false);
    expect(submit("PCH").props.disabled).toBe(false);
    await (submit("PCH").props.onClick as () => Promise<void>)();
    expect(h.upload).toHaveBeenCalledTimes(4);
    expect(h.rpc.mock.calls[0][1].p_evidence).not.toHaveProperty("support_plan_quarterly_review");
  });

  it("clears documents and their reviews when a different source is selected", () => {
    prepare();
    for (const kind of ["initial_assessment_15day", "support_plan_30day", "support_plan_quarterly_review"]) reviewed(kind);
    expect(submit().props.disabled).toBe(false);
    choice("campus-source", "other-source");
    expect(submit().props.disabled).toBe(true);
    expect(render().some(node => node.props.id === "campus-reviewer-initial_assessment_15day")).toBe(false);
    for (const kind of kinds) choice(`campus-${kind}`, `source-${kind}`);
    for (const kind of ["initial_assessment_15day", "support_plan_30day", "support_plan_quarterly_review"]) choice(`campus-format-${kind}`, "official");
    expect(submit().props.disabled).toBe(true);
  });
});
