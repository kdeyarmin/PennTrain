import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPreparationState, type AppointmentLike } from "@/lib/residentAppointments";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));

import { useResidentAppointmentPreparation, useResidentAppointments } from "./useResidentAppointments";

interface QueryCall {
  table: string;
  range?: [number, number];
  order: string[];
  resident?: string;
  ids?: string[];
}
let calls: QueryCall[];
let appointments: Record<string, unknown>[];
let items: Record<string, unknown>[];
let failOffset: number | undefined;

beforeEach(() => {
  calls = []; appointments = []; items = []; failOffset = undefined;
  mocks.useQuery.mockReset();
  mocks.from.mockReset().mockImplementation((table: string) => {
    const call: QueryCall = { table, order: [] };
    calls.push(call);
    const query = {
      select: () => query,
      eq: (_column: string, value: string) => { call.resident = value; return query; },
      in: (_column: string, values: string[]) => { call.ids = values; return query; },
      order: (column: string) => { call.order.push(column); return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      then: (resolve: (result: unknown) => unknown) => {
        const [from, to] = call.range ?? [0, 999];
        const source = table === "resident_appointments"
          ? appointments.filter((row) => row.resident_id === call.resident)
          : items.filter((row) => call.ids?.includes(row.appointment_id as string));
        return Promise.resolve(resolve({
          data: failOffset === from ? null : source.slice(from, Math.min(to + 1, from + 1000)),
          error: failOffset === from ? new Error("Appointment page unavailable") : null,
        }));
      },
    };
    return query;
  });
});

async function result() {
  return (mocks.useQuery.mock.calls.at(-1)![0] as {
    queryFn: () => Promise<Record<string, unknown>[]>;
  }).queryFn();
}

describe("complete resident appointment reads", () => {
  it("retains an old open follow-up beyond 1,000 more recent closed visits", async () => {
    appointments = Array.from({ length: 1001 }, (_, index) => ({
      id: `appointment-${index}`, resident_id: "resident-a", status: index === 1000 ? "follow_up_required" : "closed",
    }));
    appointments.push({ id: "other-resident", resident_id: "resident-b" });
    useResidentAppointments("resident-a");
    const rows = await result();
    expect(rows).toHaveLength(1001);
    expect(rows.at(-1)).toMatchObject({ id: "appointment-1000", status: "follow_up_required" });
    expect(calls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    for (const call of calls) {
      expect(call.resident).toBe("resident-a");
      expect(call.order).toEqual(["starts_at", "id"]);
    }
  });

  it("does not certify an incomplete preparation list as ready at the API cap", async () => {
    items = Array.from({ length: 1001 }, (_, index) => ({
      id: `item-${index}`, appointment_id: "appointment-a", item_kind: "task", label: `Task ${index}`,
      required: true, ready: index < 1000, ready_at: null, note: null,
    }));
    useResidentAppointmentPreparation(["appointment-a"]);
    const rows = await result();
    const state = buildPreparationState({
      appointment: { status: "scheduled", starts_at: "2026-09-16T12:00:00Z" } as AppointmentLike,
      items: rows as unknown as Parameters<typeof buildPreparationState>[0]["items"],
    });
    expect(rows).toHaveLength(1001);
    expect(state.ready).toBe(false);
    expect(state.outstanding).toEqual([expect.objectContaining({ id: "item-1000" })]);
    for (const call of calls) expect(call.order).toEqual(["item_kind", "label", "id"]);
  });

  it("bounds and deduplicates appointment IDs so long histories fit request URLs", async () => {
    const ids = Array.from({ length: 205 }, (_, index) => `appointment-${String(index).padStart(3, "0")}`);
    items = ids.map((id) => ({ id: `item-${id}`, appointment_id: id }));
    useResidentAppointmentPreparation([...ids].reverse().concat(ids[0]));
    expect(await result()).toHaveLength(ids.length);
    expect(calls.map((call) => call.ids?.length)).toEqual([100, 100, 5]);
    expect(calls.flatMap((call) => call.ids ?? [])).toEqual(ids);
  });

  it.each(["appointments", "preparation"])("rejects partial %s results on a later-page failure", async (kind) => {
    failOffset = 1000;
    if (kind === "appointments") {
      appointments = Array.from({ length: 1001 }, () => ({ resident_id: "resident-a" }));
      useResidentAppointments("resident-a");
    } else {
      items = Array.from({ length: 1001 }, () => ({ appointment_id: "appointment-a" }));
      useResidentAppointmentPreparation(["appointment-a"]);
    }
    await expect(result()).rejects.toThrow("Appointment page unavailable");
  });
});
