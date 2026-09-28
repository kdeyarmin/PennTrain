export interface NavigationLink {
  href: string;
  label: string;
}

const ROOT_PATHS = new Set(["/admin", "/app", "/trainer", "/me"]);

/** Pick the closest destination, so a parent and its action/subpage never compete. */
export function activeNavigationHref(items: readonly NavigationLink[], location: string): string | null {
  const [path, query = ""] = location.split("?");
  const current = new URLSearchParams(query);
  let winner: string | null = null;
  let highestScore = -1;
  for (const item of items) {
    const [target, targetQuery = ""] = item.href.split("?");
    if (path !== target && (ROOT_PATHS.has(target) || !path.startsWith(`${target}/`))) continue;
    const criteria = [...new URLSearchParams(targetQuery)].filter(([key]) => key !== "facilityId");
    if (criteria.length && (path !== target || !criteria.every(([key, value]) =>
      (current.get(key) || (key === "tab" ? "overview" : "")) === value))) continue;
    const score = target.length * 100 + criteria.length;
    if (score > highestScore) { winner = item.href; highestScore = score; }
  }
  return winner;
}

export function navigationMatchesQuery(
  item: NavigationLink,
  query: string,
  sectionTitle = "",
  keywords: readonly string[] = [],
): boolean {
  const text = `${item.label} ${sectionTitle} ${keywords.join(" ")}`.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(word => text.includes(word));
}

// Keep everyday shortcuts visible, with the full workspace grouped beneath them.
// The current group opens automatically, and explicit saved choices always win on reload.
export const DEFAULT_COLLAPSED_SECTIONS = new Set([
  "People", "Training", "Credentials", "Residents & care", "Safety & survey",
  "Advanced", "Admin", "Content Studio", "Oversight", "Directory",
  "Training & credentials", "Competency", "Records",
  "More training tools", "Management",
]);

/** An intentionally empty saved array means every group is expanded. */
export function parseCollapsedSections(raw: string | null): Set<string> {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (Array.isArray(value) && value.every(title => typeof title === "string")) return new Set(value);
  } catch { /* Unavailable or damaged preferences use the first-visit layout. */ }
  return new Set(DEFAULT_COLLAPSED_SECTIONS);
}
