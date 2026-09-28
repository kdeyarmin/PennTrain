import { describe, expect, it } from "vitest";
import { recommendationQuery, recommendationReturnHref, recommendationState } from "./courseRecommendationNavigation";

describe("recommendation return navigation", () => {
  it("round-trips owner queue filters and page without accepting another destination", () => {
    const search = recommendationQuery({ recommendationStatus: "in_progress", recommendationSearch: "A & B", recommendationPage: "2", return: "https://example.org" }, "thread");
    expect(search).toBe("from=courses&recommendationStatus=in_progress&recommendationSearch=A+%26+B&recommendationPage=2");
    expect(recommendationReturnHref(true, search)).toBe("/admin/courses?section=recommendations&recommendationStatus=in_progress&recommendationSearch=A+%26+B&recommendationPage=2");
    expect(recommendationReturnHref(false, search)).toContain("/app/courses?section=recommendations");
  });
  it.each(["0", "-1", "1.5", "Infinity", "wrong", "9999999999999999999"])("normalizes invalid page %s", page => {
    expect(recommendationState({ recommendationPage: page }).recommendationPage).toBe("1");
  });
  it("drops unrecognized status and bounds carried search text", () => {
    const result = recommendationState({ recommendationStatus: "approved", recommendationSearch: "x".repeat(300), recommendationPage: "02" });
    expect(result).toEqual({ recommendationStatus: "all", recommendationSearch: "x".repeat(200), recommendationPage: "2" });
  });
});
