import { describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({ useMutation: (options: unknown) => options, useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
import { useRecordCertificationAttemptItem } from "./useCertificationAttempts";
describe("certification checklist refresh", () => {
  it("keeps item writes pending until the current checklist and attempt have refreshed", async () => {
    const release: Array<() => void> = []; h.invalidate.mockImplementation(() => new Promise<void>(resolve => release.push(resolve)));
    const mutation = useRecordCertificationAttemptItem("employee") as unknown as { onSuccess: () => Promise<unknown> };
    let settled = false; const pending = mutation.onSuccess().then(() => { settled = true; });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["certification-checklist"] });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["certification-attempts", "employee"] });
    release[0](); await Promise.resolve(); expect(settled).toBe(false);
    release.slice(1).forEach(resolve => resolve()); await pending; expect(settled).toBe(true);
  });
});
