import { describe, expect, it, vi } from "vitest";
import { findArticleForRoute, type HelpArticle } from "./useHelpArticles";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

function article(id: string, href: string): HelpArticle {
  return {
    id,
    article_type: "job_aide",
    title: id,
    category: "Testing",
    sort_order: 1,
    is_published: true,
    audience: ["trainer"],
    content: {
      summary: "summary",
      audience: ["trainer"],
      steps: ["step"],
      relatedRoute: { label: "Open", href },
    },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    updated_by: null,
  } as unknown as HelpArticle;
}

describe("findArticleForRoute", () => {
  it("matches trainer routes against their role-canonical app related routes", () => {
    const articles = [article("employees", "/app/employees")];

    expect(findArticleForRoute(articles, "/trainer/employees/employee-1", "trainer")?.id).toBe("employees");
  });

  it("ignores query strings and hashes when matching the origin route", () => {
    const articles = [article("reports", "/app/reports")];

    expect(findArticleForRoute(articles, "/app/reports?view=monthly#saved", "org_admin")?.id).toBe("reports");
  });

  it("does not match inaccessible related routes for the current role", () => {
    const articles = [article("users", "/app/users")];

    expect(findArticleForRoute(articles, "/app/users", "employee")).toBeUndefined();
  });
});
