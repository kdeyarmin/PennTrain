import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.useQuery, useMutation: () => ({}), useQueryClient: () => ({}) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: vi.fn() }));
import { useOrganizationExports } from "./useProductExperience";
beforeEach(() => vi.clearAllMocks());
describe("organization export recovery polling", () => {
  it.each([
    ["pending", 0, 3, 5000], ["processing", 1, 3, 5000], ["failed", 1, 3, 5000],
    ["failed", 3, 3, false], ["succeeded", 1, 3, false],
  ])("polls %s with %i/%i attempts only while the archive is still owed", (status, attempt_count, max_attempts, expected) => {
    useOrganizationExports("org");
    const options = h.useQuery.mock.calls[0][0];
    expect(options.refetchInterval({ state: { data: [{ status, attempt_count, max_attempts }] } })).toBe(expected);
  });
});
