import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MfaStatus } from "@/lib/mfaSecurity";

const mocks = vi.hoisted(() => ({ useQuery: vi.fn(), location: "/app/users", signOut: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery, useQueryClient: () => ({}) }));
vi.mock("@/lib/auth", () => ({
  useSignOut: () => mocks.signOut, useAuth: () => ({ user: null }),
  markExplicitPasswordSignIn: vi.fn(), markIdleUnlockSignIn: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/hooks/useOrganizationSettings", () => ({ useGetOrganizationSettings: () => ({ data: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({
  useLocation: () => [mocks.location, vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { MfaPolicyGate } from "./SessionSecurityGates";

const verification: MfaStatus = {
  verified: true, method: "sms", verifiedAt: "2026-09-09T12:00:00Z",
  expiresAt: "2099-09-09T20:00:00Z", hasVerifiedFactor: true, smsRequired: true,
  smsFactors: [{ id: "sms", maskedPhone: "••• ••• 4567", createdAt: "2026-09-09T12:00:00Z" }],
};
const query = (overrides: Record<string, unknown> = {}) => ({
  isLoading: false, isError: false, refetch: vi.fn(),
  data: { requirement: { required: true }, verification, assuranceIsCurrent: true }, ...overrides,
});
const render = () => renderToStaticMarkup(<MfaPolicyGate><main>Protected user editor</main></MfaPolicyGate>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.location = "/app/users";
  mocks.useQuery.mockReturnValue(query());
});

describe("MFA workspace gate", () => {
  it("opens only from the authoritative SMS proof and does not require a fabricated native AAL2 claim", () => {
    expect(render()).toContain("Protected user editor");
  });

  it("keeps protected content hidden while status is loading or cannot be read", () => {
    mocks.useQuery.mockReturnValueOnce(query({ isLoading: true, data: undefined }));
    expect(render()).not.toContain("Protected user editor");
    mocks.useQuery.mockReturnValueOnce(query({ isError: true }));
    const html = render();
    expect(html).toContain("Multi-factor policy unavailable");
    expect(html).not.toContain("Protected user editor");
  });

  it("rejects stale cached SMS proof at its deadline and preserves the blocked destination", () => {
    mocks.useQuery.mockReturnValueOnce(query({ data: {
      requirement: { required: true }, verification: { ...verification, expiresAt: "2020-01-01T00:00:00Z" }, assuranceIsCurrent: true,
    } }));
    const html = render();
    expect(html).toContain("Multi-factor verification required");
    expect(html).toContain('/account/security?next=%2Fapp%2Fusers');
    expect(html).not.toContain("Protected user editor");
  });

  it("keeps a new password session behind verification even though the account has an enrolled factor", () => {
    mocks.useQuery.mockReturnValueOnce(query({ data: {
      requirement: { required: true }, verification: { ...verification, verified: false, method: null }, assuranceIsCurrent: false,
    } }));
    const html = render();
    expect(html).toContain("Multi-factor verification required");
    expect(html).not.toContain("Protected user editor");
  });

  it("preserves native authenticator access for accounts without SMS", () => {
    mocks.useQuery.mockReturnValueOnce(query({ data: {
      requirement: { required: true }, verification: { ...verification, method: "totp", expiresAt: null, smsRequired: false, smsFactors: [] }, assuranceIsCurrent: true,
    } }));
    expect(render()).toContain("Protected user editor");
  });

  it("requires SMS for opted-in learner accounts even when their role has no privileged MFA policy", () => {
    mocks.useQuery.mockReturnValueOnce(query({ data: {
      requirement: { required: false }, verification: { ...verification, verified: false, method: null }, assuranceIsCurrent: true,
    } }));
    const html = render();
    expect(html).toContain("Multi-factor verification required");
    expect(html).not.toContain("Protected user editor");
  });

  it("keeps SMS mandatory after an administrator resets the account's enrolled number", () => {
    mocks.useQuery.mockReturnValueOnce(query({ data: {
      requirement: { required: false }, verification: { ...verification, verified: false, method: null, hasVerifiedFactor: false, smsFactors: [] }, assuranceIsCurrent: true,
    } }));
    const html = render();
    expect(html).toContain("Multi-factor verification required");
    expect(html).not.toContain("Protected user editor");
  });

  it("still enforces the privileged session age after an otherwise successful second factor", () => {
    mocks.useQuery.mockReturnValueOnce(query({ data: {
      requirement: { required: true }, verification, assuranceIsCurrent: false,
    } }));
    const html = render();
    expect(html).toContain("Sign in again to continue");
    expect(html).not.toContain("Protected user editor");
  });

  it("keeps enrollment and recovery reachable when the policy service is failing", () => {
    mocks.location = "/account/security";
    mocks.useQuery.mockReturnValueOnce(query({ isError: true, data: undefined }));
    expect(render()).toContain("Protected user editor");
  });
});
