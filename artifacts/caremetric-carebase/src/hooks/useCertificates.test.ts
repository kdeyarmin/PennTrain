import { beforeEach, describe, expect, it, vi } from "vitest";

type Page = { range: number[]; orders: string[]; filters: unknown[][] };
const h = vi.hoisted(() => ({ cap: 1000, failLater: false, pages: [] as Page[], from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListCertificates } from "./useCertificates";

beforeEach(() => {
  vi.clearAllMocks(); h.cap = 1000; h.failLater = false; h.pages = [];
  h.from.mockImplementation(() => {
    const page: Page = { range: [], orders: [], filters: [] }; h.pages.push(page);
    const query = {
      select: () => query,
      order: (key: string) => { page.orders.push(key); return query; },
      range: (start: number, end: number) => { page.range = [start, end]; return query; },
      eq: (key: string, value: unknown) => { page.filters.push([key, value]); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: page.range[0] === 0 ? Array.from({ length: h.cap }, (_, id) => ({ id: `certificate-${id}` })) : page.range[0] === h.cap ? [{ id: "oldest-certificate" }] : [],
        error: h.failLater && page.range[0] > 0 ? new Error("Certificate history unavailable") : null,
      }).then(resolve),
    };
    return query;
  });
});

const fetchCertificates = () => (useListCertificates({ employeeId: "employee", courseId: "course", facilityId: "facility" }) as unknown as { queryFn: () => Promise<{ id: string }[]> }).queryFn();
describe("complete certificate history", () => {
  it.each([1000, 2])("includes the oldest certificate when the server caps pages at %i rows", async cap => {
    h.cap = cap;
    const rows = await fetchCertificates();
    expect(rows).toHaveLength(cap + 1);
    expect(rows.at(-1)?.id).toBe("oldest-certificate");
    expect(h.pages.map(page => page.range)).toEqual([[0, 999], [cap, cap + 999], [cap + 1, cap + 1000]]);
    for (const page of h.pages) {
      expect(page.orders).toEqual(["issued_at", "id"]);
      expect(page.filters).toEqual([["facility_id", "facility"], ["employee_id", "employee"], ["course_id", "course"]]);
    }
  });
  it("rejects a failed later page instead of presenting partial certificate history", async () => {
    h.cap = 2; h.failLater = true;
    await expect(fetchCertificates()).rejects.toThrow("Certificate history unavailable");
  });
});
