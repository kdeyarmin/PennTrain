#!/usr/bin/env node
/**
 * Validate hand-written entries in database.types.ts against the generator's formatting rules.
 *
 * WHY THIS EXISTS. `check:database` regenerates this file from a live database and diffs it, but it
 * needs Docker, so it only runs in CI. Every entry added between local runs is written by hand, and
 * a formatting mismatch fails the `database` job after a full migration + pgTAP cycle -- an expensive
 * way to learn that a line was 82 characters instead of 80.
 *
 * Each rule below corresponds to a mistake that actually reached CI:
 *
 *   1. Row/Insert/Update carrying different column sets. An insertion script that placed columns by
 *      matching optionality put all thirteen in Insert, because Insert and Update both use "?:".
 *   2. An Args block written on one line when it exceeds the generator's 80-column wrap.
 *   3. A zero-argument function written multi-line; the generator emits `{ Args: never; ... }`.
 *   4. Keys out of ASCII order within a section, including a function accidentally placed among the
 *      tables because the search matched a table with a similar name.
 *   5. A function entry written multi-line when the WHOLE entry fits in 80 columns. Rule 2 measures
 *      the Args line alone, so a short Args block inside a short entry passed it and still failed
 *      CI -- the generator makes the wrap decision on `name: { Args: ...; Returns: ... }` entire.
 *
 * This does NOT replace `check:database`. It catches the mechanical mistakes cheaply; only the real
 * generator can confirm the *content* is right.
 */
import { readFileSync } from "node:fs";

const FILE = "artifacts/caremetric-carebase/src/lib/database.types.ts";
const WRAP_COLUMN = 80;

const problems = [];
const lines = readFileSync(FILE, "utf8").split(/\r?\n/);

// ---------------------------------------------------------------------------
// Walk the file, tracking which section each top-level key belongs to.
// ---------------------------------------------------------------------------
let section = null;
let previousKey = null;
let sectionStartLine = 0;

/** Entries collected per table for the column-set comparison. */
const tableEntries = [];
let currentTable = null;

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];

  const sectionMatch = line.match(/^ {4}(Tables|Views|Functions|Enums|CompositeTypes): \{$/);
  if (sectionMatch) {
    section = sectionMatch[1];
    previousKey = null;
    sectionStartLine = i + 1;
    continue;
  }
  if (/^ {4}\}$/.test(line)) {
    section = null;
    currentTable = null;
    continue;
  }
  if (!section) continue;

  const keyMatch = line.match(/^ {6}([a-z_][a-z0-9_]*): (\{ Args|\{)/);
  if (keyMatch) {
    const key = keyMatch[1];
    if (previousKey !== null && key < previousKey) {
      problems.push(
        `${FILE}:${i + 1}: "${key}" comes after "${previousKey}" in ${section} `
        + `(section starts line ${sectionStartLine}); keys must be in ASCII order.`,
      );
    }
    previousKey = key;

    if (section === "Tables" || section === "Views") {
      currentTable = { name: key, line: i + 1, blocks: {} };
      tableEntries.push(currentTable);
    } else {
      currentTable = null;
    }
    continue;
  }

  // Column declarations inside a Row/Insert/Update block.
  if (currentTable) {
    const blockMatch = line.match(/^ {8}(Row|Insert|Update): \{$/);
    if (blockMatch) {
      currentTable.currentBlock = blockMatch[1];
      currentTable.blocks[blockMatch[1]] = [];
      continue;
    }
    if (/^ {8}Relationships: \[/.test(line)) {
      currentTable.currentBlock = null;
      continue;
    }
    const columnMatch = line.match(/^ {10}([a-z_][a-z0-9_]*)\??: /);
    if (columnMatch && currentTable.currentBlock) {
      currentTable.blocks[currentTable.currentBlock].push(columnMatch[1]);
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 1: Row, Insert and Update must describe the same columns.
// ---------------------------------------------------------------------------
for (const table of tableEntries) {
  const present = ["Row", "Insert", "Update"].filter((block) => table.blocks[block]);
  if (present.length < 2) continue; // Views legitimately have only Row.
  const [reference, ...others] = present;
  const referenceSet = new Set(table.blocks[reference]);
  for (const block of others) {
    const blockSet = new Set(table.blocks[block]);
    const missing = [...referenceSet].filter((column) => !blockSet.has(column));
    const extra = [...blockSet].filter((column) => !referenceSet.has(column));
    if (missing.length > 0) {
      problems.push(
        `${FILE}:${table.line}: table "${table.name}" -- ${block} is missing `
        + `${missing.length} column(s) that ${reference} has: ${missing.join(", ")}`,
      );
    }
    if (extra.length > 0) {
      problems.push(
        `${FILE}:${table.line}: table "${table.name}" -- ${block} has `
        + `${extra.length} column(s) ${reference} does not: ${extra.join(", ")}`,
      );
    }
  }
  for (const block of present) {
    const columns = table.blocks[block];
    const sorted = [...columns].sort();
    if (columns.join("\0") !== sorted.join("\0")) {
      const firstBad = columns.findIndex((column, index) => column !== sorted[index]);
      problems.push(
        `${FILE}:${table.line}: table "${table.name}" -- ${block} columns are not in ASCII order `
        + `(first out of place: "${columns[firstBad]}")`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 2 and 3: function Args formatting.
// ---------------------------------------------------------------------------
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];

  // A single-line Args block that the generator would have wrapped.
  if (/^ {8}Args: \{ .* \}$/.test(line) && line.length > WRAP_COLUMN) {
    problems.push(
      `${FILE}:${i + 1}: Args is ${line.length} characters on one line; the generator wraps at `
      + `${WRAP_COLUMN}. Write each parameter on its own line.`,
    );
  }
  // A multi-line block the generator would have kept inline.
  if (/^ {8}Args: \{$/.test(line)) {
    const closing = lines.indexOf("        }", i);
    if (closing > i) {
      const params = lines.slice(i + 1, closing)
        .map((entry) => entry.trim())
        .filter(Boolean);
      const inline = `        Args: { ${params.join("; ")} }`;
      if (inline.length <= WRAP_COLUMN && params.length > 0) {
        problems.push(
          `${FILE}:${i + 1}: Args fits on one line (${inline.length} chars); the generator would `
          + `not wrap it. Write it as: ${inline.trim()}`,
        );
      }
    }
  }
  // Zero-argument functions.
  if (/^ {8}Args: Record<PropertyKey, never>$/.test(line)) {
    problems.push(
      `${FILE}:${i + 1}: zero-argument functions are emitted as \`{ Args: never; Returns: X }\` on `
      + `one line, not as Record<PropertyKey, never>.`,
    );
  }

  // Rule 4: the wrap decision is made on the WHOLE entry, not on the Args line alone.
  //
  // Rule 2 above catches an Args block that should collapse. It does not catch an entry whose Args
  // and Returns each fit comfortably but whose combined single-line form also fits -- the generator
  // collapses that to one line, and only expands when the whole thing exceeds the wrap column. A
  // 38-character Args line inside a 78-character entry sails past rule 2 and still fails CI.
  const entryMatch = line.match(/^ {6}([a-z_][a-z0-9_]*): \{$/);
  if (entryMatch
      && /^ {8}Args: (\{ .* \}|never|[A-Za-z].*)$/.test(lines[i + 1] ?? "")
      && /^ {8}Returns: .*[^{]$/.test(lines[i + 2] ?? "")
      && (lines[i + 3] ?? "") === "      }") {
    const inline = `      ${entryMatch[1]}: { ${lines[i + 1].trim()}; ${lines[i + 2].trim()} }`;
    if (inline.length <= WRAP_COLUMN) {
      problems.push(
        `${FILE}:${i + 1}: the whole entry fits on one line (${inline.length} chars); the generator `
        + `would not wrap it. Write it as: ${inline.trim()}`,
      );
    }
  }
}

if (tableEntries.length === 0) {
  problems.push(`${FILE}: no table/view entries were recognized; refusing to pass without validating the schema.`);
}

if (problems.length > 0) {
  console.error(`database.types.ts format check failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nThese are the mechanical mistakes that have each cost a CI round. `check:database` still has\n"
    + "the final word on whether the content matches the schema.",
  );
  process.exit(1);
}

console.log(
  `database.types.ts format check passed (${tableEntries.length} table/view entries validated).`,
);
