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
    // react-query's default mutation networkMode is "online", which does not fail a write while
    // `navigator.onLine` is false -- it PAUSES it. The mutation never settles, so the button keeps
    // its spinner, no `onError` runs, no toast appears, and a reload discards the write silently:
    // nothing here persists or resumes paused mutations (`isPaused` is read nowhere, and there is
    // no MutationCache handler). A caregiver on facility wifi therefore had no way to learn that a
    // save had not happened.
    //
    // "always" makes the request run and fail fast, which reaches the `onError` handlers the write
    // hooks already have. This does not weaken offline documentation: that lane never depended on
    // paused mutations -- it writes to the encrypted IndexedDB store first and syncs from
    // OfflineSyncManager -- and a network-level failure there is already a keep-and-retry.
    mutations: {
      networkMode: "always",
    },
  },
});
