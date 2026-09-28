import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseBlock } from "@/hooks/useCourses";

const h = vi.hoisted(() => ({ invoke: vi.fn(), effect: null as null | (() => void | (() => void)) }));
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: typeof h.effect) => { h.effect = effect; },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (options: { mutationFn: (id: string) => Promise<unknown> }) => ({ mutate: options.mutationFn }),
}));
import { useAutoCheckVideoStatuses } from "./useCourseVideoGeneration";

beforeEach(() => {
  vi.useFakeTimers(); h.invoke.mockReset().mockResolvedValue({ data: { success: true, status: "processing" }, error: null });
  h.effect = null;
});
afterEach(() => vi.useRealTimers());
const block = (status: string) => ({ id: "video-block", body: { heygen: { status } } }) as CourseBlock;

describe("course video polling respects course authoring permission", () => {
  it("does not send privileged status mutations while a facility admin browses pending content", async () => {
    useAutoCheckVideoStatuses([block("processing")], false);
    expect(h.effect?.()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("keeps polling available to the super admin and stops on cleanup", async () => {
    useAutoCheckVideoStatuses([block("processing"), block("completed")], true);
    const cleanup = h.effect?.();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("check-course-video-status", { body: { course_block_id: "video-block" } });
    if (typeof cleanup === "function") cleanup();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not poll finished or missing videos", async () => {
    for (const blocks of [undefined, [], [block("completed"), block("failed")]]) {
      useAutoCheckVideoStatuses(blocks, true);
      expect(h.effect?.()).toBeUndefined();
    }
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
