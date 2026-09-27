import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  error: false, fetching: false, token: "a".repeat(64),
  room: undefined as unknown, portal: undefined as unknown,
  refetch: vi.fn(), clear: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useEffect: (effect: () => void) => effect(),
}));
vi.mock("wouter", () => ({ useParams: () => ({}) }));
vi.mock("@/lib/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/publicAccessToken", () => ({
  consumePublicAccessToken: () => h.token, readPublicAccessToken: () => h.token,
  storePublicAccessToken: vi.fn(), clearStoredPublicAccessToken: h.clear,
}));
vi.mock("@/hooks/useEvidenceRoom", () => ({
  useEvidenceGuestRoom: () => ({ data: h.room, isError: h.error, isFetching: h.fetching, refetch: h.refetch }),
  useAcceptEvidenceGuestTerms: () => ({}), useEvidenceGuestDownload: () => ({}),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: h.portal, isError: h.error, isFetching: h.fetching, refetch: h.refetch }),
  useMutation: () => ({}),
}));
vi.mock("@/hooks/useResidentPortal", () => ({
  acceptResidentPortalTerms: vi.fn(), getResidentPortalDocumentDownload: vi.fn(), getResidentPortalExperience: vi.fn(),
  postResidentPortalMessage: vi.fn(), postResidentPortalRequest: vi.fn(), respondResidentPortalSchedule: vi.fn(),
}));

import EvidenceGuestRoom from "./EvidenceGuestRoom";
import ResidentDesignatedPersonPortal from "./ResidentDesignatedPersonPortal";

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

beforeEach(() => {
  vi.clearAllMocks(); h.error = false; h.fetching = false; h.token = "a".repeat(64); h.room = undefined; h.portal = undefined;
  vi.stubGlobal("window", { location: { href: "https://app.test/resident-portal" } });
});

describe.each([
  { label: "documentation room", page: EvidenceGuestRoom },
  { label: "designated-person portal", page: ResidentDesignatedPersonPortal },
])("$label recovery", ({ page }) => {
  it("offers retry after a service failure without claiming that the link expired", () => {
    h.error = true;
    const tree = page();
    expect(text(tree)).toContain("couldn't load");
    expect(text(tree)).not.toContain("This link is invalid, expired, or revoked");
    expect(text(tree)).not.toContain("This link is no longer available");
    const retry = nodes(tree).find(node => typeof node.props.onClick === "function" && text(node) === "Try again")!;
    expect(retry.props.disabled).toBe(false);
    (retry.props.onClick as () => void)();
    expect(h.refetch).toHaveBeenCalledOnce();
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("prevents repeated retry clicks while the request is in flight", () => {
    h.error = true; h.fetching = true;
    expect(nodes(page()).find(node => text(node) === "Trying again…" && node.props.onClick)?.props.disabled).toBe(true);
  });

  it("keeps denied access distinct from a temporary outage", () => {
    h.room = { authorized: false, needsTerms: false };
    h.portal = { accessStatus: "invalid" };
    const tree = page();
    expect(text(tree)).toMatch(/This link is (no longer available|invalid, expired, or revoked)/);
    expect(nodes(tree).some(node => node.props.onClick && text(node) === "Try again")).toBe(false);
  });
});

it("hides stale resident information when refreshing access fails", () => {
  h.error = true;
  h.portal = { accessStatus: "active", resident: { displayName: "Private Resident" }, permissions: ["messages"] };
  expect(text(ResidentDesignatedPersonPortal())).not.toContain("Private Resident");
});

it("labels both required routine-request fields and explains their minimum length", () => {
  h.portal = { accessStatus: "active", resident: { displayName: "Resident" }, permissions: ["requests"] };
  const tree = ResidentDesignatedPersonPortal();
  for (const id of ["portal-request-subject", "portal-request-detail"]) {
    expect(nodes(tree).some(node => node.props.htmlFor === id)).toBe(true);
    expect(nodes(tree).find(node => node.props.id === id)?.props["aria-describedby"]).toBe("portal-request-guidance");
  }
  expect(text(tree)).toContain("Enter at least 3 characters in both the subject and details.");
});
