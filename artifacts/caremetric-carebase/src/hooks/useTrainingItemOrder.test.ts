import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rpc: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@tanstack/react-query", () => ({ useMutation: (options: unknown) => options, useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
import { useTrainingItemOrder, type TrainingOrderResource } from "./useTrainingItemOrder";
type Mutation = { mutationFn: (input: { first: { id: string; sort_order: number }; second: { id: string; sort_order: number } }) => Promise<void>; onSettled: () => Promise<unknown> };
beforeEach(() => { vi.resetAllMocks(); h.rpc.mockResolvedValue({ error: null }); h.invalidate.mockResolvedValue(undefined); });
describe.each(["course_blocks", "quiz_questions", "training_plan_items", "competency_template_items"] as TrainingOrderResource[])("atomic %s ordering", resource => {
  it("sends both identities and expected positions together, then reloads the correct list", async () => {
    const mutation = useTrainingItemOrder(resource) as unknown as Mutation;
    await mutation.mutationFn({ first: { id: "a", sort_order: 3 }, second: { id: "b", sort_order: 7 } });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("swap_training_item_order", { p_resource: resource, p_first_id: "a", p_second_id: "b", p_first_sort_order: 3, p_second_sort_order: 7 });
    await mutation.onSettled();
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: [resource === "training_plan_items" ? "training_plans" : resource] });
  });
  it("propagates rejection and waits for authoritative refresh before releasing pending controls", async () => {
    h.rpc.mockResolvedValue({ error: new Error("Order changed") });
    const mutation = useTrainingItemOrder(resource) as unknown as Mutation;
    await expect(mutation.mutationFn({ first: { id: "a", sort_order: 3 }, second: { id: "b", sort_order: 7 } })).rejects.toThrow("Order changed");
    const release: Array<() => void> = []; h.invalidate.mockImplementation(() => new Promise<void>(resolve => release.push(resolve)));
    let settled = false; const pending = mutation.onSettled().then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false); release.forEach(resolve => resolve()); await pending; expect(settled).toBe(true);
  });
});
