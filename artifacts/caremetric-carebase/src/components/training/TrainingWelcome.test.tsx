import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn(), welcome: vi.fn(), refetch: vi.fn(), pending: false, error: false,
  data: { facility_name: "Cedar House", organization_name: "Care Group", logo_path: "org/logo.png", welcome: { welcome_message: "Welcome, Cedar staff.", contact_name: "Casey Trainer", contact_email: "trainer@example.test" }, setup: { staff: 0, portal_ready: 0, plans: 0, assigned: 0 } },
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => [initial, vi.fn()] }));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: "https://signed.example.test/logo" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "learner-profile" } }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useEmployees", () => ({ useGetEmployeeByProfileId: () => ({ data: { id: "learner" } }) }));
vi.mock("@/hooks/useTrainingExperience", () => ({ useTrainingWelcome: (...args: unknown[]) => { h.welcome(...args); return { data: h.data, isError: h.error, refetch: h.refetch }; }, useSaveTrainingExperience: () => ({ mutateAsync: h.save, isPending: h.pending }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
import { TrainingWelcome, TrainingWelcomeSettings, TrainingAdminWalkthrough } from "./TrainingWelcome";
type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Node, ...nodes((node as Node).props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Node).props.children as ReactNode) : "";
}
async function submit(tree: ReactNode) {
  const form = nodes(tree).find(node => node.type === "form")!;
  await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn(), currentTarget: { values: { welcome_message: "Please complete your orientation.", contact_name: "Alex Educator", contact_email: "alex@example.test" } } });
}
beforeEach(() => {
  h.pending = false; h.error = false; h.save.mockReset().mockResolvedValue({}); h.toast.mockReset(); h.welcome.mockReset();
  vi.stubGlobal("FormData", class { constructor(private form: { values: Record<string, string> }) {} get(key: string) { return this.form.values[key] ?? null; } });
});
afterEach(() => vi.unstubAllGlobals());
describe("facility learning welcome", () => {
  it("saves the edited welcome and contact details in the explicitly selected facility", async () => {
    const tree = TrainingWelcomeSettings({ facilityId: "facility-a" });
    expect(h.welcome).toHaveBeenCalledWith("facility-a", true);
    await submit(tree);
    expect(h.save).toHaveBeenCalledWith({ action: "save_welcome", facilityId: "facility-a", data: { welcome_message: "Please complete your orientation.", contact_name: "Alex Educator", contact_email: "alex@example.test" } });
    expect(h.toast).toHaveBeenCalledWith({ title: "Learner welcome saved" });
  });
  it("does not report success when saving fails and disables duplicate submission while pending", async () => {
    h.save.mockRejectedValueOnce(new Error("Facility access changed"));
    await submit(TrainingWelcomeSettings({ facilityId: "facility-a" }));
    expect(h.toast).toHaveBeenCalledWith({ title: "Welcome could not be saved", description: "Facility access changed", variant: "destructive" });
    expect(h.toast).not.toHaveBeenCalledWith({ title: "Learner welcome saved" });
    h.pending = true;
    const button = nodes(TrainingWelcomeSettings({ facilityId: "facility-a" })).find(node => text(node) === "Save learner welcome" && node.props.disabled !== undefined)!;
    expect(button.props.disabled).toBe(true);
  });
  it("shows facility branding, the named contact and the evidence destination to the learner", () => {
    const tree = TrainingWelcome();
    expect(h.welcome).toHaveBeenCalledWith(undefined, true);
    expect(text(tree)).toContain("Welcome to learning at Cedar House");
    expect(text(tree)).toContain("Welcome, Cedar staff.");
    expect(nodes(tree).find(node => node.type === "img")?.props).toMatchObject({ src: "https://signed.example.test/logo", alt: "Care Group logo" });
    expect(nodes(tree).some(node => node.props.href === "mailto:trainer@example.test")).toBe(true);
    expect(nodes(tree).some(node => node.props.href === "/me/certificates")).toBe(true);
  });
  it("routes setup guide steps to working facility tabs and offers the first-student link", () => {
    const onTab = vi.fn();
    const tree = TrainingAdminWalkthrough({ facilityId: "facility-a", onTab, addStudentHref: "/app/employees?facilityId=facility-a" });
    const open = nodes(tree).filter(node => text(node) === "Open" && typeof node.props.onClick === "function");
    for (const node of open) (node.props.onClick as () => void)();
    expect(onTab.mock.calls.map(call => call[0])).toEqual(["settings", "students", "yearly-plans", "yearly-plans", "enrollments"]);
    expect(nodes(tree).some(node => node.props.href === "/app/employees?facilityId=facility-a")).toBe(true);
  });
  it("does not expose an editable welcome when the read failed", () => {
    h.error = true;
    const tree = TrainingWelcomeSettings({ facilityId: "facility-a" });
    expect(text(tree)).toContain("Welcome settings could not be loaded");
    expect(nodes(tree).some(node => node.type === "form")).toBe(false);
  });
});
