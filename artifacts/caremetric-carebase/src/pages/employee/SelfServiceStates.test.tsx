import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ employee: {} as Record<string, unknown>, passport: {} as Record<string, unknown>, swaps: {} as Record<string, unknown>, toast: vi.fn(), retry: vi.fn(), credentialScope: vi.fn(), certificateScope: vi.fn(), trainingScope: vi.fn(), shiftScope: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "test",
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useMemo: (compute: () => unknown) => compute(), useRef: (value: unknown) => ({ current: value }), useEffect: () => undefined,
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile", role: "employee" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useEmployees", () => ({ useGetEmployeeByProfileId: () => h.employee }));
vi.mock("@/hooks/useEmployeeCredentials", () => ({ useListEmployeeCredentials: (...args: unknown[]) => { h.credentialScope(...args); return { data: [] }; } }));
vi.mock("@/hooks/useCredentialDocuments", () => ({ useUploadCredentialDocument: () => ({}) }));
vi.mock("@/hooks/useCredentialRenewals", () => ({ useCreateCredentialRenewalSubmission: () => ({}) }));
vi.mock("@/hooks/useCertificates", () => ({ useListCertificates: (...args: unknown[]) => { h.certificateScope(...args); return { data: [] }; }, usePrepareCertificatePdf: () => ({}) }));
vi.mock("@/hooks/useCourses", () => ({ useListCourses: () => ({ data: [] }) }));
vi.mock("@/hooks/useProductExperience", () => ({ useMyTrainingPassport: () => ({ enable: {}, revoke: {}, ...h.passport }) }));
vi.mock("@/hooks/useTrainingRecords", () => ({ useListTrainingRecords: (...args: unknown[]) => { h.trainingScope(...args); return { data: [] }; } }));
vi.mock("@/hooks/useTrainingTypes", () => ({ useListTrainingTypes: () => ({ data: [] }) }));
vi.mock("@/hooks/useShiftAssignments", () => ({ useListShiftAssignments: (...args: unknown[]) => { h.shiftScope(...args); return { data: [] }; } }));
vi.mock("@/hooks/useDailyOperations", () => ({
  useCancelTimeOffRequest: () => ({}), useClaimOpenShift: () => ({}), useMyShiftWorkspace: () => ({}),
  useCancelShiftSwapRequest: () => ({}), useMyShiftSwapRequests: () => h.swaps, useRequestShiftSwap: () => ({}),
  useShiftSwapCandidates: () => ({}), useSubmitTimeOffRequest: () => ({}),
}));
import MyCredentials from "./MyCredentials";
import MyCertificates from "./MyCertificates";
import MyTrainings from "./MyTrainings";
import MySchedule from "./MySchedule";

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Element, ...nodes((node as Element).props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Element).props.children as ReactNode) : "";
}
beforeEach(() => { vi.clearAllMocks(); h.employee = { isError: true, error: new Error("Network unavailable"), refetch: h.retry }; h.passport = {}; h.swaps = {}; });

describe.each([["credentials", MyCredentials, h.credentialScope], ["certificates", MyCertificates, h.certificateScope], ["training records", MyTrainings, h.trainingScope], ["schedule", MySchedule, h.shiftScope]] as const)("employee %s", (_label, Page, scope) => {
  it("shows a recoverable profile error without claiming the employee has no records", () => {
    const tree = Page();
    const error = nodes(tree).find(node => node.props.what === "your employee profile");
    expect(error).toBeDefined();
    (error!.props.onRetry as () => void)();
    expect(h.retry).toHaveBeenCalled();
    expect(text(tree)).not.toMatch(/No (credentials|certificates|training records|upcoming shifts)/);
    expect(scope).toHaveBeenCalledWith(expect.objectContaining({ employeeId: undefined }), expect.objectContaining({ enabled: false }));
  });
  it("explains a missing profile separately from an empty history", () => {
    h.employee = { data: null };
    expect(text(Page())).toContain("No employee profile is linked to your account");
  });
});

describe("passport and shift request recovery", () => {
  it("does not offer passport creation while the existing passport is loading", () => {
    h.passport = { isLoading: true };
    const tree = MyCertificates();
    expect(text(tree)).toContain("Loading your training passport");
    expect(text(tree)).not.toContain("Create my passport");
  });
  it("shows a retry for passport lookup errors", () => {
    h.passport = { isError: true, error: new Error("Offline"), refetch: h.retry };
    const tree = MyCertificates();
    expect(nodes(tree).some(node => node.props.what === "your training passport")).toBe(true);
    expect(text(tree)).not.toContain("Create my passport");
  });
  it("surfaces missing clipboard access instead of leaving an unhandled rejection", async () => {
    h.passport = { data: { is_active: true, slug: "passport" } };
    const tree = MyCertificates();
    const copy = nodes(tree).find(node => text(node.props.children as ReactNode) === "Copy share link" && typeof node.props.onClick === "function")!;
    (copy.props.onClick as () => void)();
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not copy the link", variant: "destructive" })));
  });
  it("shows failed swap-request lookup rather than silently hiding pending requests", () => {
    h.swaps = { isError: true, error: new Error("Unavailable"), refetch: h.retry };
    expect(nodes(MySchedule()).some(node => node.props.what === "your shift swap requests")).toBe(true);
  });
});
