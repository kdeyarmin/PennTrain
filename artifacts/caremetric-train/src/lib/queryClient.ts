import { QueryClient } from "@tanstack/react-query";

// Default staleTime of 0 (react-query's factory default) means every page revisit -- even
// tabbing between two already-visited pages -- refetches from Supabase and re-shows a loading
// skeleton. A minute-long staleTime treats data as "still fresh" across ordinary navigation
// while keeping refetch-on-mount for genuinely new query keys (first visit to a page/filter
// combo) and refetch-on-reconnect for dropped connections. Hooks that need tighter freshness
// (alerts, notification deliveries) opt into a shorter staleTime individually.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});
