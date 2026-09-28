export const RECOMMENDATION_DEFAULTS = { recommendationStatus: "all", recommendationSearch: "", recommendationPage: "1" };

export function recommendationState(values: Record<string, string>) {
  const status = ["open", "in_progress", "resolved", "closed"].includes(values.recommendationStatus) ? values.recommendationStatus : "all";
  const parsedPage = Number(values.recommendationPage);
  return {
    recommendationStatus: status,
    recommendationSearch: (values.recommendationSearch ?? "").slice(0, 200),
    recommendationPage: String(Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1),
  };
}

/** Carry only known filters, never a caller-supplied return URL or route. */
export function recommendationQuery(values: Record<string, string>, destination: "thread" | "catalog") {
  const params = new URLSearchParams(destination === "thread" ? { from: "courses" } : { section: "recommendations" });
  const state = recommendationState(values);
  for (const key of Object.keys(RECOMMENDATION_DEFAULTS) as (keyof typeof RECOMMENDATION_DEFAULTS)[]) {
    if (state[key] !== RECOMMENDATION_DEFAULTS[key]) params.set(key, state[key]);
  }
  return params.toString();
}

export function recommendationReturnHref(owner: boolean, search: string) {
  return `${owner ? "/admin" : "/app"}/courses?${recommendationQuery(Object.fromEntries(new URLSearchParams(search)), "catalog")}`;
}
