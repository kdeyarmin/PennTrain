import { readdirSync, readFileSync } from "node:fs";
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
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

/**
 * The taxonomy as the migrations leave it, replayed in filename order.
 *
 * This used to read a hard-coded pair of seed migrations and compare only the KEYS. That was a
 * snapshot, not a mirror, and it had already gone stale: 20260729215900 re-upserts
 * `inspection_war_room` with a different label and description, and 20260906020000 retires
 * `exclusion_match` -- neither file was being read, so the client's label could drift (it had) and
 * a new type registered by a later migration would have left the queue showing a humanized
 * fallback chip with CI green. Replaying every migration that writes the table, and comparing
 * label, category, sort order and active as well as the key, is the check the header comment
 * always claimed.
 *
 * Only statically literal statements are replayed. Two `insert ... select distinct` adoption
 * statements (20260726120100's safety nets and 20260729215900's repeat of them) read
 * `work_item_templates` / `work_items` at migration time and cannot be resolved from the file;
 * both are `on conflict (key) do nothing`, so they can only ADD a key this replay does not know
 * about. `work_item_source_taxonomy.test.sql` checks that direction against a real database
 * ("every source type present on a work item must exist in the taxonomy"), and the queue tolerates
 * it either way: `app_private.classify_work_item_source()` registers an unknown type on first use
 * with `initcap(replace(key, '_', ' '))`, which is exactly what `workItemSourceLabel` renders for a
 * key this build has not heard of.
 */
interface SeededSourceType {
  key: string;
  label: string;
  category: string;
  description: string;
  sortOrder: number;
  active: boolean;
}

/** Split a literal SQL tuple on top-level commas, respecting '' escaping inside strings. */
function splitTuple(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (inString) {
      if (char === "'" && body[i + 1] === "'") { current += "''"; i += 1; continue; }
      if (char === "'") { inString = false; current += char; continue; }
      current += char;
      continue;
    }
    if (char === "'") { inString = true; current += char; continue; }
    if (char === ",") { parts.push(current.trim()); current = ""; continue; }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

/** A literal value, or null for anything computed -- `new.source_type`, a function call, a column. */
function literalValue(token: string): string | number | boolean | null {
  if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
  if (token === "true" || token === "false") return token === "true";
  if (/^-?\d+$/.test(token)) return Number(token);
  return null;
}

/** The rest of the statement, from `values` to the `;` that ends it, ignoring `;` inside strings. */
function statementTail(sql: string, from: number): string {
  let inString = false;
  for (let i = from; i < sql.length; i += 1) {
    const char = sql[i];
    if (inString) {
      if (char === "'" && sql[i + 1] === "'") { i += 1; continue; }
      if (char === "'") inString = false;
      continue;
    }
    if (char === "'") { inString = true; continue; }
    if (char === ";") return sql.slice(from, i);
  }
  return sql.slice(from);
}

/** Read the `(...)` tuples of a `values` list, stopping at `on conflict` or the statement end. */
function valueTuples(sql: string, from: number): string[] {
  const tuples: string[] = [];
  let i = from;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) { i = sql.indexOf("\n", i) + 1 || sql.length; continue; }
    const char = sql[i];
    if (char === ";") break;
    if (/\s|,/.test(char)) { i += 1; continue; }
    if (sql.slice(i).toLowerCase().startsWith("on conflict")) break;
    if (char !== "(") break;
    let depth = 0;
    let inString = false;
    let j = i;
    for (; j < sql.length; j += 1) {
      const c = sql[j];
      if (inString) {
        if (c === "'" && sql[j + 1] === "'") { j += 1; continue; }
        if (c === "'") inString = false;
        continue;
      }
      if (c === "'") { inString = true; continue; }
      if (c === "(") depth += 1;
      else if (c === ")") { depth -= 1; if (depth === 0) break; }
    }
    tuples.push(sql.slice(i + 1, j));
    i = j + 1;
  }
  return tuples;
}

function replayMigrations(): Map<string, SeededSourceType> {
  const state = new Map<string, SeededSourceType>();
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  let literalInserts = 0;
  for (const name of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    if (!sql.includes("work_item_source_types")) continue;

    const insertRe = /insert\s+into\s+public\.work_item_source_types\s*\(([^)]*)\)\s*values\b/gi;
    let match: RegExpExecArray | null;
    while ((match = insertRe.exec(sql))) {
      const columns = match[1].split(",").map((column) => column.trim());
      const valuesAt = match.index + match[0].length;
      const overwrites = /on conflict\s*\(key\)\s*do update/i.test(statementTail(sql, valuesAt));
      for (const tuple of valueTuples(sql, valuesAt)) {
        const values = splitTuple(tuple).map(literalValue);
        // `app_private.classify_work_item_source()` registers an unrecognized type at runtime with
        // a computed label, and this is that statement's text. It is not a seed -- the client's
        // `workItemSourceLabel` humanizes such a key exactly as the trigger does -- so skip it
        // rather than record a row whose values only exist at insert time.
        if (values.some((value) => value === null)) continue;
        const row: Record<string, string | number | boolean> = {};
        columns.forEach((column, index) => { row[column] = values[index]!; });
        const key = String(row.key);
        if (state.has(key) && !overwrites) continue;
        state.set(key, {
          key,
          label: String(row.label),
          category: String(row.category),
          description: String(row.description),
          sortOrder: Number(row.sort_order ?? 0),
          active: row.active === undefined ? true : Boolean(row.active),
        });
        literalInserts += 1;
      }
    }

    const updateRe =
      /update\s+public\.work_item_source_types\s+set\s+active\s*=\s*(true|false)\s+where\s+key\s*=\s*'([a-z_]+)'/gi;
    while ((match = updateRe.exec(sql))) {
      const existing = state.get(match[2]);
      expect(existing, `${name} retires ${match[2]}, which nothing seeded`).toBeDefined();
      if (existing) state.set(match[2], { ...existing, active: match[1].toLowerCase() === "true" });
    }
  }
  // Guards the parser itself: a regex that silently stopped matching would otherwise turn every
  // assertion below into a comparison of two empty things.
  expect(literalInserts, "no literal taxonomy rows were parsed out of the migrations")
    .toBeGreaterThan(30);
  return state;
}

describe("the taxonomy matches the database seed", () => {
  // The server rejects a source type outside the taxonomy, so a client list that has drifted from
  // the seed shows blank chips for rows it cannot name. Asserting it here means drift is caught in
  // CI rather than found on somebody's queue.
  it("has exactly the keys the migrations leave in the table", () => {
    expect([...WORK_ITEM_SOURCE_TYPES.map((entry) => entry.key)].sort())
      .toEqual([...replayMigrations().keys()].sort());
  });

  it("carries the same label, category, sort order and active flag as the migrations", () => {
    const seeded = replayMigrations();
    for (const entry of WORK_ITEM_SOURCE_TYPES) {
      const row = seeded.get(entry.key);
      expect(row, `${entry.key} is in the client list but not in the migrations`).toBeDefined();
      if (!row) continue;
      expect({
        label: entry.label,
        category: entry.category,
        sortOrder: entry.sortOrder,
        active: entry.active !== false,
      }, entry.key).toEqual({
        label: row.label,
        category: row.category,
        sortOrder: row.sortOrder,
        active: row.active,
      });
    }
  });

  it("seeds no key twice within one literal block", () => {
    const sql = readFileSync(
      join(MIGRATIONS_DIR, "20260726100100_work_item_source_taxonomy_and_coverage.sql"),
      "utf8",
    );
    const start = sql.indexOf("insert into public.work_item_source_types (key");
    const keys = [...sql.slice(start, sql.indexOf("on conflict (key)", start))
      .matchAll(/\('([a-z_]+)',/g)].map((entry) => entry[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every source type the mapping function can produce", () => {
    const sql = readFileSync(
      join(MIGRATIONS_DIR, "20260726100100_work_item_source_taxonomy_and_coverage.sql"),
      "utf8",
    );
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
