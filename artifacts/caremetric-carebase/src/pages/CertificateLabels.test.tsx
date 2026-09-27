import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ certificate: { id: "issued-certificate-id", course_id: "raw-course-id", course_title_snapshot: "Fire_Safety_v3.pdf" as string | null, issued_at: "2026-09-27", expires_at: null, credential_number: "CM-VALID-12", slug: "signed-verification-slug", pdf_status: "ready" }, prepare: vi.fn(), open: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useMemo: (factory: () => unknown) => factory(), useState: (value: unknown) => [value, vi.fn()] }));
vi.mock("wouter", () => ({ Link: "a", useParams: () => ({ slug: "signed-verification-slug" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile" } }) }));
vi.mock("@/hooks/useEmployees", () => ({ useGetEmployeeByProfileId: () => ({ data: { id: "employee", organization_id: "org", facility_id: "facility" } }) }));
vi.mock("@/hooks/useCourses", () => ({ useListCourses: () => ({ data: [] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useProductExperience", () => ({ useMyTrainingPassport: () => ({ data: { is_active: false }, enable: {}, revoke: {} }) }));
vi.mock("@/lib/openDocumentUrl", () => ({ openDocumentUrl: h.open }));
vi.mock("@/components/training/TrainingRecords", () => ({ TrainingRecords: () => null }));
vi.mock("@/hooks/useCertificates", () => ({
  useListCertificates: () => ({ data: [h.certificate] }),
  usePrepareCertificatePdf: () => ({ mutateAsync: h.prepare }),
  useVerifyCertificate: () => ({ data: { course_title: "Fire_Safety_v3.pdf", employee_name: "Pat Example", organization_name: "Example Home", issued_at: "2026-09-27", is_valid: true, credential_number: "CM-VALID-12", course_code: "internal-code", course_version: "release_2026_v3" } }),
}));
import MyCertificates from "./employee/MyCertificates";
import VerifyCertificate from "./VerifyCertificate";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : "";
}
beforeEach(() => {
  vi.clearAllMocks(); h.certificate.course_title_snapshot = "Fire_Safety_v3.pdf";
  h.prepare.mockResolvedValue({ url: "https://example.test/storage/v1/object/sign/certificates/uuid.pdf?token=original-signature" });
});

describe("readable certificate presentation", () => {
  it("shows the readable issued course title and keeps the certificate verification number and link", () => {
    const tree = MyCertificates();
    expect(text(tree)).toContain("Fire Safety");
    expect(text(tree)).not.toContain("Fire_Safety_v3.pdf");
    expect(text(tree)).toContain("Certificate number: CM-VALID-12");
    expect(nodes(tree).some(node => node.props.href === "/verify/signed-verification-slug")).toBe(true);
  });

  it("uses a general title instead of exposing a course database ID", () => {
    h.certificate.course_title_snapshot = null;
    expect(text(MyCertificates())).toContain("Training certificate");
    expect(text(MyCertificates())).not.toContain("raw-cour");
  });

  it("downloads the same issued certificate with a readable suggested filename", async () => {
    const download = nodes(MyCertificates()).find(node => node.props.onClick && text(node).trim() === "Download")!;
    await (download.props.onClick as () => Promise<void>)();
    expect(h.prepare).toHaveBeenCalledWith("issued-certificate-id");
    const opened = new URL(h.open.mock.calls[0][0]);
    expect(opened.pathname).toBe("/storage/v1/object/sign/certificates/uuid.pdf");
    expect(opened.searchParams.get("token")).toBe("original-signature");
    expect(opened.searchParams.get("download")).toBe("Fire Safety - Certificate.pdf");
  });

  it("keeps technical course identifiers in collapsed record details on verification", () => {
    const tree = VerifyCertificate();
    const details = nodes(tree).find(node => node.type === "details")!;
    expect(details.props.open).toBeUndefined();
    expect(text(details)).toContain("Course record details");
    expect(text(details)).toContain("release_2026_v3");
    expect(text(tree)).toContain("Fire Safety");
    expect(text(tree)).toContain("CM-VALID-12");
    expect(text(tree)).not.toContain("Fire_Safety_v3.pdf");
  });
});
