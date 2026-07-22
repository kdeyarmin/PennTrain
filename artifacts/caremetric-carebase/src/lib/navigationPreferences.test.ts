import { describe, expect, it } from "vitest";
import { defaultFavoritePathsForRole, navigationFavoritePaths } from "./navigationPreferences";

describe("navigation favorites", () => {
  it("provides role defaults when no preference row exists", () => {
    expect(navigationFavoritePaths(undefined, false, "facility_manager")[0]).toBe("/app/today");
  });

  it("respects a user who intentionally clears favorites", () => {
    expect(navigationFavoritePaths([], true, "facility_manager")).toEqual([]);
  });

  it("returns stored favorites when present", () => {
    expect(navigationFavoritePaths(["/app/reports"], true, "org_admin")).toEqual(["/app/reports"]);
  });

  it("keeps employee default favorites inside self-service", () => {
    expect(defaultFavoritePathsForRole("employee").every((path) => path.startsWith("/me"))).toBe(true);
  });
});
