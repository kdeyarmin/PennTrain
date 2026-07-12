import { describe, expect, it } from "vitest";
import type { Tables } from "./database.types";
import { filterHelpArticlesForRole, isHelpArticleVisibleToRole } from "./helpArticleVisibility";

type HelpArticle = Tables<"help_articles">;

function article(articleType: "faq" | "job_aide", audience?: string[]): HelpArticle {
  return {
    id: crypto.randomUUID(),
    article_type: articleType,
    category: "Training",
    title: "Example",
    sort_order: 0,
    is_published: true,
    content: articleType === "job_aide"
      ? { summary: "Example", audience, steps: ["Do the thing."] }
      : { answer: "Example answer." },
    created_by: null,
    created_at: "2026-07-09T00:00:00.000Z",
    updated_at: "2026-07-09T00:00:00.000Z",
  } as HelpArticle;
}

describe("help article role visibility", () => {
  it("keeps FAQs globally visible", () => {
    expect(isHelpArticleVisibleToRole(article("faq"), undefined)).toBe(true);
  });

  it("only shows job aides to roles in the article audience", () => {
    const adminAide = article("job_aide", ["org_admin", "facility_manager"]);
    const employeeAide = article("job_aide", ["employee"]);

    expect(filterHelpArticlesForRole([adminAide, employeeAide], "employee")).toEqual([employeeAide]);
    expect(isHelpArticleVisibleToRole(adminAide, "employee")).toBe(false);
    expect(isHelpArticleVisibleToRole(adminAide, "org_admin")).toBe(true);
  });

  it("hides unaudienced job aides from role-scoped views", () => {
    expect(isHelpArticleVisibleToRole(article("job_aide"), "employee")).toBe(false);
    expect(isHelpArticleVisibleToRole(article("job_aide", []), "org_admin")).toBe(false);
    expect(isHelpArticleVisibleToRole(article("job_aide", ["employee"]), undefined)).toBe(false);
  });
});
