import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countBySourceType,
  groupByCategory,
  WORK_ITEM_CATEGORY_LABELS,
  WORK_ITEM_SOURCE_TYPES,
  workItemCategory,
  workItemSourceHref,
  workItemSourceLabel,
  workItemSourceType,
} from "./workItemSources";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

// The taxonomy is seeded across two migrations: the original, and the follow-up that completed it
// after the first seed turned out not to be a superset of the types already in use.
const SEED_MIGRATIONS = [
  "supabase/migrations/20260726100000_work_item_source_taxonomy_and_coverage.sql",
  "supabase/migrations/20260726120000_complete_the_work_item_source_taxonomy.sql",
];

function migrationSql(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function seededKeys(): string[] {
  const keys: string[] = [];
  for (const path of SEED_MIGRATIONS) {
    const sql = migrationSql(path);
    const start = sql.indexOf("insert into public.work_item_source_types (key, label, category, description, sort_order) values");
    expect(start, `literal seed block not found in ${path}`).toBeGreaterThan(-1);
    const end = sql.indexOf("on conflict (key)", start);
    expect(end, `seed block end not found in ${path}`).toBeGreaterThan(start);
    // Each seeded row starts with ('key', ...
    keys.push(...[...sql.slice(start, end).matchAll(/\('([a-z_]+)',/g)].map((match) => match[1]));
  }
  return keys;
}

describe("the taxonomy matches the database seed", () => {
  // The server rejects a source type outside the taxonomy, so a client list that has drifted from
  // the seed shows blank chips for rows it cannot name. Asserting it here means drift is caught in
  // CI rather than found on somebody's queue.
  it("has exactly the keys the migration seeds", () => {
    expect([...WORK_ITEM_SOURCE_TYPES.map((entry) => entry.key)].sort())
      .toEqual([...seededKeys()].sort());
  });

  it("seeds no key twice", () => {
    const keys = seededKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every source type the mapping function can produce", () => {
    const sql = migrationSql(SEED_MIGRATIONS[0]);
    const start = sql.indexOf("function app_private.work_item_source_type_for");
    const end = sql.indexOf("$$;", start);
    const mapped = [...sql.slice(start, end).matchAll(/then '([a-z_]+)'/g)].map((m) => m[1]);
    expect(mapped.length).toBeGreaterThan(0);
    for (const key of mapped) {
      expect(workItemSourceType(key), `${key} is mapped to but not in the taxonomy`).toBeDefined();
    }
  });
});

describe("the taxonomy itself", () => {
  it("has unique keys", () => {
    const keys = WORK_ITEM_SOURCE_TYPES.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every type a category with a label", () => {
    for (const entry of WORK_ITEM_SOURCE_TYPES) {
      expect(WORK_ITEM_CATEGORY_LABELS[entry.category], entry.key).toBeTruthy();
    }
  });

  it("gives every type a description someone could act on", () => {
    for (const entry of WORK_ITEM_SOURCE_TYPES) {
      expect(entry.description.length, entry.key).toBeGreaterThan(20);
    }
  });

  it("covers the fifteen sources the request names", () => {
    // Request item 17b's list, in its own words, mapped onto taxonomy keys.
    for (const key of [
      "assessment", "support_plan", "incident", "complaint", "credential", "training_gap",
      "maintenance", "admission_document", "emergency_drill", "policy", "corrective_action",
      "qapi", "hospital_return", "resident_agreement", "regulatory_requirement",
    ]) {
      expect(workItemSourceType(key), `${key} is missing from the taxonomy`).toBeDefined();
    }
  });

  it("keeps the catch-all as a real member rather than deleting it", () => {
    // Work that genuinely does not fit still needs somewhere to go, and a queue filtered to this
    // value is the to-do list for whoever maintains the taxonomy.
    expect(workItemSourceType("rule_exception")).toBeDefined();
  });
});

describe("labels", () => {
  it("names a known type from the taxonomy", () => {
    expect(workItemSourceLabel("hospital_return")).toBe("Hospital return");
  });

  it("humanizes an unknown type rather than rendering nothing", () => {
    // A row this build does not know about must still be readable.
    expect(workItemSourceLabel("something_new")).toBe("Something new");
  });

  it("returns no category for an unknown type", () => {
    expect(workItemCategory("something_new")).toBeNull();
  });
});

describe("source links", () => {
  it("links the types that have a page", () => {
    expect(workItemSourceHref({ source_type: "incident", source_id: "i1" })).toBe("/app/incidents/i1");
    expect(workItemSourceHref({ source_type: "near_miss", source_id: "i1" })).toBe("/app/incidents/i1");
    expect(workItemSourceHref({ source_type: "qapi", source_id: "q1" })).toBe("/app/qapi");
  });

  it("returns nothing for a type with no page, rather than a route that would 404", () => {
    expect(workItemSourceHref({ source_type: "staffing", source_id: "s1" })).toBeNull();
    expect(workItemSourceHref({ source_type: "unknown_type", source_id: "x" })).toBeNull();
  });
});

describe("counting and grouping", () => {
  const items = [
    { source_type: "incident" }, { source_type: "incident" },
    { source_type: "assessment" },
    { source_type: "credential" },
    { source_type: "support_plan" },
  ];

  it("counts each source type", () => {
    const counts = countBySourceType(items);
    expect(counts.find((entry) => entry.key === "incident")?.count).toBe(2);
    expect(counts.find((entry) => entry.key === "assessment")?.count).toBe(1);
  });

  it("orders counts by the taxonomy rather than by size or name", () => {
    // Resident care leads because that is the order the taxonomy declares, even though `incident`
    // has the larger count.
    expect(countBySourceType(items).map((entry) => entry.key))
      .toEqual(["assessment", "support_plan", "credential", "incident"]);
  });

  it("drops types with nothing in them", () => {
    expect(countBySourceType([{ source_type: "incident" }]).map((entry) => entry.key))
      .toEqual(["incident"]);
  });

  it("rolls up to categories, dropping empty ones", () => {
    const groups = groupByCategory(items);
    expect(groups.map((group) => group.category)).toEqual(["resident_care", "quality", "workforce"]);
    expect(groups.find((group) => group.category === "resident_care")?.count).toBe(2);
    expect(groups.find((group) => group.category === "quality")?.count).toBe(2);
  });

  it("returns nothing for an empty queue", () => {
    expect(countBySourceType([])).toEqual([]);
    expect(groupByCategory([])).toEqual([]);
  });

  it("counts an unknown type under compliance rather than dropping the row", () => {
    const groups = groupByCategory([{ source_type: "something_new" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
  });
});
