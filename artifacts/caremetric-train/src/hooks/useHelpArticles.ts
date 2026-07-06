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
