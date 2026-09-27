import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, create: vi.fn(), update: vi.fn(), toast: vi.fn(),
  facilities: [] as Record<string, unknown>[],
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useId: () => "facility-test", useEffect: () => {}, useMemo: (factory: () => unknown) => factory(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }];
  },
}));
vi.mock("@/hooks/useFacilities", () => ({
  useListFacilities: () => ({ data: h.facilities, isLoading: false, isError: false }),
  useCreateFacility: () => ({ mutate: h.create, isPending: false }),
  useUpdateFacility: () => ({ mutate: h.update, isPending: false }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: () => [{ search: "" }, vi.fn()] }));
import Facilities from "./Facilities";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  return [value as Node, ...nodes((value as Node).props.children as ReactNode)];
}
function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : "";
}
function render() { h.cursor = 0; return Facilities(); }
function click(label: string) {
  const button = nodes(render()).find(node => typeof node.props.onClick === "function" && text(node).trim() === label)!;
  expect(button).toBeDefined();
  (button.props.onClick as () => void)();
}
function fillName(value: string) {
  const input = nodes(render()).find(node => node.props.id === "facility-test-facility-name")!;
  (input.props.onChange as (event: unknown) => void)({ target: { value } });
}
function licenseChoice() {
  return nodes(render()).find(node => typeof node.props.onValueChange === "function"
    && nodes(node).some(child => child.props.id === "facility-test-type"));
}
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.cursor = 0; h.facilities = []; });

describe("facility license identity", () => {
  it("does not preselect PCH and refuses creation until a license is explicitly chosen", () => {
    click("Add Facility");
    expect(licenseChoice()!.props.value).toBe("");
    fillName("Assisted living facility");
    click("Create Facility");
    expect(h.create).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Select the facility's license type" }));
    (licenseChoice()!.props.onValueChange as (value: string) => void)("ALR");
    click("Create Facility");
    expect(h.create.mock.calls[0][0]).toMatchObject({ name: "Assisted living facility", organization_id: "org", facility_type: "ALR" });
  });

  it.each(["PCH", "ALR"])("keeps an existing %s license fixed while ordinary details can be edited", facilityType => {
    h.facilities = [{ id: "facility", name: "Existing facility", facility_type: facilityType, is_active: true }];
    const edit = nodes(render()).find(node => node.props["aria-label"] === "Edit Existing facility")!;
    (edit.props.onClick as (event: unknown) => void)({ preventDefault() {}, stopPropagation() {} });
    expect(licenseChoice()).toBeUndefined();
    expect(text(render())).toContain("The license type is fixed to preserve its regulations and records.");
    fillName("Renamed facility");
    click("Save Changes");
    expect(h.update.mock.calls[0][0]).toMatchObject({ id: "facility", name: "Renamed facility" });
    expect(h.update.mock.calls[0][0]).not.toHaveProperty("facility_type");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("preserves edits between other supported facility types without allowing a PCH/ALF reclassification", () => {
    h.facilities = [{ id: "facility", name: "Existing facility", facility_type: "NH", is_active: true }];
    const edit = nodes(render()).find(node => node.props["aria-label"] === "Edit Existing facility")!;
    (edit.props.onClick as (event: unknown) => void)({ preventDefault() {}, stopPropagation() {} });
    const choice = licenseChoice()!;
    expect(choice.props.value).toBe("NH");
    const options = nodes(choice).filter(node => typeof node.props.value === "string" && node !== choice).map(node => node.props.value);
    expect(options).toEqual(["NH", "HHA", "HOS", "GH"]);
    (choice.props.onValueChange as (value: string) => void)("HHA");
    click("Save Changes");
    expect(h.update.mock.calls[0][0]).toMatchObject({ id: "facility", facility_type: "HHA" });
  });
});
