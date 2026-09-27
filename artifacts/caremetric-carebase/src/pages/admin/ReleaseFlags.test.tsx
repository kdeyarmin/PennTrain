import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ killError: false, killLoading: false, releaseError: false }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/admin/ReleaseCohortMembershipCard", () => ({ ReleaseCohortMembershipCard: () => null }));
vi.mock("@/hooks/useFeatureRelease", () => ({ useFeatureReleaseActive: () => ({
  isLoading: false, isError: harness.releaseError, isActive: false,
}) }));
vi.mock("@/hooks/useReleaseFlagAdmin", () => ({
  useReleaseFlags: () => ({ data: [{ feature_key: "reports.export", rollout_mode: "global", is_enabled: true, owner: "reports" }], refetch: vi.fn() }),
  useFeatureDefinitions: () => ({ data: [], refetch: vi.fn() }),
  useFeatureKillSwitches: () => ({ data: undefined, isError: harness.killError, isLoading: harness.killLoading, error: harness.killError ? new Error("Kill status unavailable") : null, refetch: vi.fn() }),
  useSetReleaseFlag: () => ({ mutateAsync: vi.fn() }),
  useSetFeatureKillSwitch: () => ({ mutateAsync: vi.fn() }),
}));

import ReleaseFlags from "./ReleaseFlags";

beforeEach(() => { harness.killError = false; harness.killLoading = false; harness.releaseError = false; });

describe("release control failure states", () => {
  it.each(["killError", "killLoading"] as const)("disables the kill action while its existing state is unknown: %s", (state) => {
    harness[state] = true;
    const markup = renderToStaticMarkup(<ReleaseFlags />);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Kill<\/button>/);
    if (state === "killError") expect(markup).toContain("Kill status unavailable");
  });

  it("distinguishes an evaluation outage from a feature known to be off", () => {
    harness.releaseError = true;
    const markup = renderToStaticMarkup(<ReleaseFlags />);
    expect(markup).toContain("Unavailable");
    expect(markup).not.toContain("Off for you");
  });
});
