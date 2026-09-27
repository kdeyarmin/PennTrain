import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), useMutation: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(), useMutation: mocks.useMutation, useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }));
import { useSaveEmergencyInventoryItem } from "./useEmergencyOperations";

const input = { organizationId: "org-a", facilityId: "facility-a", inventoryType: "water", itemName: "Water", quantity: 24, minimumQuantity: 12, unit: "bottles", status: "ready", location: "Store", notes: "Sealed", checkedBy: "manager-a" };
beforeEach(() => vi.clearAllMocks());

describe("emergency inventory replenishment", () => {
  it("updates a scoped existing item and preserves notes without inserting a duplicate", async () => {
    const insert = vi.fn(); const update = vi.fn(); const eq = vi.fn();
    const query = { insert, update, eq, select: () => query, single: async () => ({ data: { id: "item-a" }, error: null }) };
    insert.mockReturnValue(query); update.mockReturnValue(query); eq.mockReturnValue(query);
    mocks.from.mockReturnValue(query);
    useSaveEmergencyInventoryItem();
    const mutation = mocks.useMutation.mock.calls[0][0];
    await mutation.mutationFn({ ...input, id: "item-a", expirationDate: undefined });
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ quantity: 24, notes: "Sealed", expiration_date: null, checked_by: "manager-a" }));
    expect(eq.mock.calls).toEqual([["id", "item-a"], ["facility_id", "facility-a"], ["organization_id", "org-a"]]);
    mutation.onSuccess();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["emergency"] });
  });

  it.each([-1, NaN, Infinity])("rejects invalid stock quantity %s before writing", async (quantity) => {
    useSaveEmergencyInventoryItem();
    await expect(mocks.useMutation.mock.calls[0][0].mutationFn({ ...input, quantity })).rejects.toThrow("non-negative");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
