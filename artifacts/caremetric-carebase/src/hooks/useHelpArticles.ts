import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type HelpArticle = Tables<"help_articles">;
export type HelpArticleInsert = TablesInsert<"help_articles">;
export type HelpArticleUpdate = TablesUpdate<"help_articles">;

export interface FaqContent {
  answer: string;
}

export interface JobAideContent {
  summary: string;
  audience: string[];
  steps: string[];
  tips?: string[] | null;
  relatedRoute?: { label: string; href: string } | null;
}

// Route prefixes for HelpCenter.tsx itself (mounted at both /app/help and /me/help, plus each
// base's ticket-detail sub-route). Used to exclude Help's own pages from the "last visited route"
// Header.tsx tracks below, so opening Help doesn't overwrite the very context it's about to read.
const HELP_ROUTE_PREFIXES = ["/app/help", "/me/help"];
export function isHelpRoute(path: string): boolean {
  return HELP_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

// Session-scoped key for the last non-Help route the user visited, written by Header.tsx on every
// navigation and read by HelpCenter.tsx so it can contextually pin whichever job aide's
// `relatedRoute` matches where the user came from. Keeping this in sessionStorage -- rather than,
// say, a query param the Help entry point would have to construct -- means every way of reaching
// Help (the header's `?` button, the sidebar's Help link, a deep link, browser back/forward)
// benefits, without any of them needing to know which article, if any, is relevant.
export const LAST_VISITED_ROUTE_KEY = "caremetric.help.lastVisitedRoute";

// Finds the job aide (if any) whose `relatedRoute.href` matches `route` -- an exact match, or
// `route` nested under it (e.g. an aide for "/app/employees" also matches "/app/employees/123").
// FAQ articles never have a relatedRoute (see FaqContent above), so only job_aide articles can
// ever match; callers pass whichever article list they already have loaded.
export function findArticleForRoute(articles: HelpArticle[], route: string | null | undefined): HelpArticle | undefined {
  if (!route) return undefined;
  return articles.find((a) => {
    const href = (a.content as unknown as JobAideContent).relatedRoute?.href;
    if (!href) return false;
    const normalizedHref = href.length > 1 ? href.replace(/\/+$/, "") : href;
    return route === normalizedHref || route.startsWith(`${normalizedHref}/`);
  });
}

// Ordered by sort_order alone (not category then sort_order) -- the seed data assigns sort_order
// sequentially over the original curated category ordering (Getting Started first, Support &
// Account last, etc.), so a plain ascending sort_order scan reconstructs both the intended
// category grouping and intra-category order without a separate category-ordering column.
export function useListHelpArticles(articleType?: "faq" | "job_aide") {
  return useQuery({
    queryKey: ["help_articles", articleType],
    queryFn: async () => {
      let query = supabase.from("help_articles").select("*").order("sort_order");
      if (articleType) query = query.eq("article_type", articleType);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateHelpArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: HelpArticleInsert) => {
      const { data, error } = await supabase.from("help_articles").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["help_articles"] }),
  });
}

export function useUpdateHelpArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: HelpArticleUpdate & { id: string }) => {
      const { data, error } = await supabase.from("help_articles").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["help_articles"] }),
  });
}

export function useDeleteHelpArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("help_articles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["help_articles"] }),
  });
}
