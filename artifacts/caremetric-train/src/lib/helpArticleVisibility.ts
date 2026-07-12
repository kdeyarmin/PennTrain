import type { Tables } from "./database.types";
import type { Role } from "./auth";

type HelpArticleLike = Pick<Tables<"help_articles">, "article_type" | "content">;

export function isHelpArticleVisibleToRole(article: HelpArticleLike, role: Role | undefined): boolean {
  if (article.article_type !== "job_aide") return true;
  if (!role) return false;

  const audience = (article.content as { audience?: unknown }).audience;
  return Array.isArray(audience) && audience.includes(role);
}

export function filterHelpArticlesForRole<T extends HelpArticleLike>(articles: T[], role: Role | undefined): T[] {
  return articles.filter((article) => isHelpArticleVisibleToRole(article, role));
}
