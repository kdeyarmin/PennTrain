import { describe, expect, it } from "vitest";
import { stripRouterBase } from "./useUrlState";

describe("stripRouterBase", () => {
  it("strips a configured deployment base before routing", () => {
    expect(stripRouterBase("/train/app/facilities", "/train/")).toBe("/app/facilities");
    expect(stripRouterBase("/train", "/train/")).toBe("/");
  });

  it("does not strip partial or unrelated path prefixes", () => {
    expect(stripRouterBase("/trainer/app", "/train/")).toBe("/trainer/app");
    expect(stripRouterBase("/app/facilities", "/train/")).toBe("/app/facilities");
  });
});
