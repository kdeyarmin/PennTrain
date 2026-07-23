// Shared model + presentation helpers for the public regulatory-updates feed and its admin
// editor. Kept pure (no React, no network) so both surfaces derive the same labels and so the
// category logic is unit-testable.
import { facilityTypeLabel } from "@/lib/facilityTypes";

export type RegulatoryUpdateCategory =
  | "new_regulation"
  | "clarification"
  | "update"
  | "guidance"
  | "enforcement";

export type RegulatoryUpdateStatus = "draft" | "published" | "archived";

/** Shape returned by the public `list_regulatory_updates` RPC. */
export interface RegulatoryUpdate {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string | null;
  category: RegulatoryUpdateCategory | string;
  facility_types: string[];
  citation: string | null;
  state: string | null;
  source_name: string | null;
  source_uri: string | null;
  effective_date: string | null;
  published_at: string | null;
  is_featured: boolean;
}

export interface RegulatoryCategoryMeta {
  value: RegulatoryUpdateCategory;
  /** Short label for badges/filters. */
  label: string;
  /** One-line explanation for the filter UI. */
  description: string;
  /** Tailwind classes for the category badge (light surface). */
  badgeClass: string;
}

// Ordered for the filter row. Colors are drawn from the marketing palette (blue = product,
// violet = ALF, amber/rose for attention-grabbing enforcement) and match the badge conventions in
// facilityTypes.ts.
export const REGULATORY_CATEGORIES: RegulatoryCategoryMeta[] = [
  {
    value: "new_regulation",
    label: "New regulation",
    description: "A new rule or requirement takes effect.",
    badgeClass: "border-blue-200 text-blue-700 bg-blue-50",
  },
  {
    value: "update",
    label: "Update",
    description: "A change to an existing requirement.",
    badgeClass: "border-violet-200 text-violet-700 bg-violet-50",
  },
  {
    value: "clarification",
    label: "Clarification",
    description: "Guidance sharpening how an existing rule is read.",
    badgeClass: "border-teal-200 text-teal-700 bg-teal-50",
  },
  {
    value: "guidance",
    label: "Guidance",
    description: "Best-practice or documentation guidance.",
    badgeClass: "border-slate-200 text-slate-600 bg-slate-50",
  },
  {
    value: "enforcement",
    label: "Enforcement",
    description: "A shift in how a requirement is surveyed or cited.",
    badgeClass: "border-amber-200 text-amber-800 bg-amber-50",
  },
];

const CATEGORY_BY_VALUE = new Map<string, RegulatoryCategoryMeta>(
  REGULATORY_CATEGORIES.map((meta) => [meta.value, meta]),
);

const FALLBACK_CATEGORY: RegulatoryCategoryMeta = {
  value: "update",
  label: "Update",
  description: "A change to an existing requirement.",
  badgeClass: "border-slate-200 text-slate-600 bg-slate-50",
};

/** Category metadata for any code, with a safe fallback for unknown values. */
export function categoryMeta(category: string | null | undefined): RegulatoryCategoryMeta {
  if (!category) return FALLBACK_CATEGORY;
  return CATEGORY_BY_VALUE.get(category) ?? FALLBACK_CATEGORY;
}

/** Human-readable category label (e.g. "New regulation"). */
export function categoryLabel(category: string | null | undefined): string {
  return categoryMeta(category).label;
}

/**
 * Facility-type labels for an update, using the canonical ALF/ALR label mapping. Returns an empty
 * array when the update applies broadly (no facility types set), so callers can show "All facility
 * types" themselves.
 */
export function updateFacilityLabels(facilityTypes: string[] | null | undefined): string[] {
  if (!facilityTypes || facilityTypes.length === 0) return [];
  return facilityTypes.map((code) => facilityTypeLabel(code));
}

export const STATUS_LABELS: Record<RegulatoryUpdateStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

/**
 * Derive a URL-safe slug from a title, matching the DB constraint
 * (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). Used to prefill the admin editor.
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160)
    .replace(/-+$/g, "");
}
