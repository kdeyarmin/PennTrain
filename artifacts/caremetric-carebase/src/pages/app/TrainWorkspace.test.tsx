import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, prepare: vi.fn(), open: vi.fn(), toast: vi.fn(), download: vi.fn(), zip: vi.fn(), preparing: false,
  certificate: { id: "issued-certificate", employee_id: "opaque-employee-id", course_id: "course", course_assignment_id: null,
    learner_name_snapshot: "Pat Original" as string | null, course_title_snapshot: "Fire_Safety_v3.pdf", credential_number: "CM-123", issued_at: "2026-09-27", pdf_status: "ready" },
  historical: [] as { id: string; first_name: string; last_name: string }[],
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.states)) h.states[index] = typeof initial === "function" ? initial() : initial;
    return [h.states[index], (next: unknown) => { h.states[index] = typeof next === "function" ? next(h.states[index]) : next; }]; }, useEffect: () => {},
}));
vi.mock("wouter", () => ({ Link: "a", useSearch: () => "facilityId=facility&tab=certificates", useLocation: () => ["/app/train", vi.fn()] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({}) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({}) }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useTrainingFacilityScope: () => ({ isReady: true, facilities: [{ id: "facility", name: "Training home", facility_type: "PCH" }] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [] }), useListEmployeesByIds: () => ({ data: h.historical }) }));
vi.mock("@/hooks/useCertificates", () => ({ useListCertificates: () => ({ data: [h.certificate] }), usePrepareCertificatePdf: () => ({ mutateAsync: h.prepare, isPending: h.preparing }) }));
vi.mock("@/hooks/useTrainingWorkspace", () => ({ useTrainingWorkspace: () => ({}), useSaveTrainingWorkspace: () => ({}) }));
vi.mock("@/hooks/useProfiles", () => ({ useInviteUser: () => ({}) }));
vi.mock("@/hooks/useDocuments", () => ({ useListDocuments: () => ({ data: [] }), useDocumentSignedUrl: () => ({}) }));
vi.mock("@/hooks/useCourseAssignments", () => ({ useListCourseAssignments: () => ({ data: [] }) }));
vi.mock("@/hooks/useCourses", () => ({ useListCourses: () => ({ data: [] }), useListCourseVersionsByIds: () => ({ data: [] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/openDocumentUrl", () => ({ openDocumentUrl: h.open }));
vi.mock("@/lib/browserDownload", () => ({ downloadBlob: h.download }));
vi.mock("fflate", () => ({ zipSync: h.zip }));
vi.mock("@/components/training/TrainingRosterDashboard", () => ({ default: () => null }));
vi.mock("@/components/training/TrainingWelcome", () => ({ TrainingAdminWalkthrough: () => null, TrainingWelcomeSettings: () => null }));
vi.mock("@/components/training/TrainingRecords", () => ({ TrainingRecords: () => null }));
vi.mock("@/components/training/TrainingEnrollmentReport", () => ({ default: () => null }));
vi.mock("@/components/training-discovery/TrainingDiscoveryAdmin", () => ({ TrainingDiscoveryAdmin: () => null }));
import TrainWorkspace from "./TrainWorkspace";

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
function render() { h.cursor = 0; return TrainWorkspace(); }
function action(label: string) { return nodes(render()).find(node => node.props.onClick && text(node) === label)!; }
const url = "https://project.supabase.co/storage/v1/object/sign/certificates/opaque.pdf?token=issued.signature";
beforeEach(() => {
  vi.clearAllMocks(); h.states = []; h.cursor = 0; h.preparing = false; h.historical = [];
  h.certificate.learner_name_snapshot = "Pat Original";
  h.prepare.mockResolvedValue({ url }); h.zip.mockReturnValue(new Uint8Array([1]));
});

describe("training workspace certificate actions", () => {
  it("preserves Open PDF / print while offering a named download from the frozen certificate", async () => {
    h.historical = [{ id: h.certificate.employee_id, first_name: "Pat", last_name: "Changed" }];
    await (action("Open PDF / print").props.onClick as () => Promise<void>)();
    expect(h.open).toHaveBeenLastCalledWith(url);
    expect(new URL(h.open.mock.calls[0][0]).searchParams.has("download")).toBe(false);
    await (action("Download PDF").props.onClick as () => Promise<void>)();
    const named = new URL(h.open.mock.calls[1][0]);
    expect(named.pathname).toBe(new URL(url).pathname);
    expect(named.searchParams.get("token")).toBe("issued.signature");
    expect(named.searchParams.get("download")).toBe("Pat Original - Fire Safety - Certificate.pdf");
    expect(h.prepare.mock.calls).toEqual([[h.certificate.id], [h.certificate.id]]);
    expect(h.certificate.course_title_snapshot).toBe("Fire_Safety_v3.pdf");
  });

  it("uses a general filename when the learner snapshot and staff record are unavailable", async () => {
    h.certificate.learner_name_snapshot = null;
    await (action("Download PDF").props.onClick as () => Promise<void>)();
    expect(new URL(h.open.mock.calls[0][0]).searchParams.get("download")).toBe("Learner - Fire Safety - Certificate.pdf");
  });

  it("uses ordinal archive entries without leaking an unavailable learner's database ID", async () => {
    h.certificate.learner_name_snapshot = null;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }));
    try {
      const certificateLabel = nodes(render()).find(node => node.type === "label" && text(node).includes("CM-123"))!;
      const checkbox = nodes(certificateLabel).find(node => node.type === "input" && node.props.type === "checkbox")!;
      (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
      await (action("Download selected certificates (ZIP)").props.onClick as () => Promise<void>)();
      await vi.waitFor(() => expect(h.zip).toHaveBeenCalledOnce());
      expect(Object.keys(h.zip.mock.calls[0][0])).toEqual(["1 - Learner - Fire Safety - Certificate.pdf"]);
      expect(h.download).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it("disables both individual actions during preparation and reports failed downloads without navigation", async () => {
    h.preparing = true;
    expect(action("Open PDF / print").props.disabled).toBe(true);
    expect(action("Download PDF").props.disabled).toBe(true);
    h.preparing = false; h.prepare.mockRejectedValue(new Error("Certificate unavailable"));
    await (action("Download PDF").props.onClick as () => Promise<void>)();
    expect(h.open).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});
