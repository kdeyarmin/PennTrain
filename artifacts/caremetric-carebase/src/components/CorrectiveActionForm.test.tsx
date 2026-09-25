import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CorrectiveAction } from "@/hooks/useCorrectiveActions";

type Employee = { id: string; profile_id: string; first_name: string; last_name: string };
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>,
  effectDeps: [] as Array<unknown[] | undefined>, effects: [] as Array<() => unknown>,
  stateIndex: 0, refIndex: 0, effectIndex: 0, dirty: false,
  employees: undefined as Employee[] | undefined, update: vi.fn(), create: vi.fn(), toast: vi.fn(),
}));

// Exercise the rendered picker and save handler across React-style state/effect passes,
// including a changed query-result identity, without adding a browser/DOM dependency.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.stateIndex++;
    if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => {
      const value = typeof next === "function" ? next(h.state[index]) : next;
      if (!Object.is(h.state[index], value)) h.dirty = true;
      h.state[index] = value;
    }];
  },
  useRef: (initial: unknown) => h.refs[h.refIndex++] ??= { current: initial },
  useEffect: (effect: () => unknown, deps?: unknown[]) => {
    const index = h.effectIndex++;
    if (!deps || !h.effectDeps[index] || deps.some((dep, i) => !Object.is(dep, h.effectDeps[index]?.[i]))) {
      h.effects.push(effect);
      h.effectDeps[index] = deps;
    }
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile-owner" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: h.employees }) }));
vi.mock("@/hooks/useCorrectiveActions", () => ({
  useCreateCorrectiveAction: () => ({ mutate: h.create, isPending: false }),
  useUpdateCorrectiveAction: () => ({ mutate: h.update, isPending: false }),
}));
vi.mock("@/components/employees/EmployeeSearchSelect", () => ({ EmployeeSearchSelect: "employee-picker" }));

import { CorrectiveActionForm } from "./CorrectiveActionForm";

type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Node, ...nodes((node as Node).props.children as ReactNode)];
}
let editing: CorrectiveAction;
function render() {
  for (let pass = 0; pass < 10; pass++) {
    h.stateIndex = 0; h.refIndex = 0; h.effectIndex = 0; h.effects = []; h.dirty = false;
    const tree = CorrectiveActionForm({ parent: { organizationId: "org-a", facilityId: "facility-a", incidentId: "incident-a" }, editing });
    h.effects.forEach(effect => effect());
    if (!h.dirty) return nodes(tree);
  }
  throw new Error("Corrective action form did not settle");
}
function picker() { return render().find(node => node.type === "employee-picker")!; }
function choose(value: string) { (picker().props.onValueChange as (value: string) => void)(value); }
function save() {
  const button = render().find(node => node.props["aria-label"] === "Save corrective action")!;
  (button.props.onClick as () => void)();
  return h.update.mock.calls.at(-1)?.[0];
}
function roster(): Employee[] {
  return [
    { id: "employee-owner", profile_id: "profile-owner", first_name: "Original", last_name: "Owner" },
    { id: "employee-new", profile_id: "profile-new", first_name: "New", last_name: "Owner" },
  ];
}

beforeEach(() => {
  h.state = []; h.refs = []; h.effectDeps = []; h.effects = []; h.employees = undefined;
  h.update.mockReset(); h.create.mockReset(); h.toast.mockReset();
  editing = {
    id: "action-a", description: "Review the follow-up plan", due_date: "2026-10-02",
    owner_profile_id: "profile-owner", owner_name: "Owner, Original", status: "open", completed_date: null,
  } as CorrectiveAction;
});

describe("corrective action owner choices", () => {
  it("preserves the existing owner while the roster loads and resolves them when it arrives", () => {
    expect(picker().props.value).toBe("__preserved_owner__");
    expect(save()).toMatchObject({ owner_profile_id: "profile-owner", owner_name: "Owner, Original" });
    h.employees = roster();
    expect(picker().props.value).toBe("employee-owner");
    expect(save()).toMatchObject({ owner_profile_id: "profile-owner", owner_name: "Owner, Original" });
  });

  it("retains the off-roster owner sentinel and saved identity across a roster refresh", () => {
    editing = { ...editing, owner_profile_id: "profile-transferred", owner_name: "Transferred Manager" };
    h.employees = roster();
    expect(picker().props.value).toBe("__preserved_owner__");
    expect(picker().props.selectedLabel).toBe("Transferred Manager (not on this facility's roster)");
    h.employees = [...roster(), { id: "employee-other", profile_id: "profile-other", first_name: "Other", last_name: "Employee" }];
    expect(picker().props.value).toBe("__preserved_owner__");
    expect(save()).toMatchObject({ owner_profile_id: "profile-transferred", owner_name: "Transferred Manager" });
  });

  it.each([
    { choice: "employee-new", label: "new owner", profileId: "profile-new", name: "Owner, New" },
    { choice: "", label: "Unassigned", profileId: null, name: null },
  ])("keeps an explicit $label choice when the employee query refreshes", ({ choice, profileId, name }) => {
    h.employees = roster();
    expect(picker().props.value).toBe("employee-owner");
    choose(choice);
    expect(picker().props.value).toBe(choice);
    // Changed data represents a genuine query update, not an identical cached reference.
    h.employees = [...roster(), { id: "employee-other", profile_id: "profile-other", first_name: "Other", last_name: "Employee" }];
    expect(picker().props.value).toBe(choice);
    expect(save()).toMatchObject({ owner_profile_id: profileId, owner_name: name });
  });

  it("keeps an explicit Unassigned choice made before the initial roster response", () => {
    expect(picker().props.value).toBe("__preserved_owner__");
    choose("");
    h.employees = roster();
    expect(picker().props.value).toBe("");
    expect(save()).toMatchObject({ owner_profile_id: null, owner_name: null });
  });
});
