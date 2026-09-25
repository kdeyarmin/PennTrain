#!/usr/bin/env node
/**
 * A CSV importer may not read a lookup's `data` without handling its `error`.
 *
 * Supabase returns `{ data, error }`. For the two read shapes an importer leans on -- a
 * `.maybeSingle()` lookup and a plain list select -- a failure and an empty result are the SAME
 * value: `data` is null (or the destructured default), and the error sits in the half nobody
 * read. So an RLS denial, a misconfigured client or a dropped connection arrives at the caller
 * wearing the costume of "there is no such record", and the importer acts on that:
 *
 *   - The resident/employee lookups reported `Unknown resident_external_id` and
 *     `Unknown employee_number`. The operator was sent to fix a CSV that was never wrong, and
 *     the real fault was recorded nowhere.
 *   - The duplicate checks -- existing resident, contact, credential, room, draft assessment,
 *     training record -- read as "no match", so the row applied as a CREATE. A failed lookup
 *     produced a second copy of a record that already existed. Half these files carry comments
 *     about the duplication they were written to prevent; this let it back in by another door.
 *   - The `data_import_rows` receipt load fed the map that makes a resumed import skip rows it
 *     already applied. Read without its error, a transient failure emptied that map, and the
 *     resume re-applied every row it had already written.
 *
 * `.single()` is deliberately NOT covered. It errors on no-row, so its failure and its absence
 * both arrive as `data: null` AND an error, and the null check that follows refuses either way.
 * It fails closed. The two shapes this gate covers fail open, which is the whole difference.
 *
 * This was not a rule someone invented after the fact: bulk-import-credentials, -employees and
 * -training-records already bound `ledgerLoadError` and refused on it. Five importers never got
 * that line, and eight never got it on their row lookups. The invariant was real, held in three
 * files out of eight, and had nowhere to live except in the memory of whoever wrote those three.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const FUNCTIONS_DIR = path.resolve(ROOT, "supabase/functions");

// A parser that suddenly finds implausibly few reads would pass vacuously. This is the count at
// adoption (29) with slack for an importer legitimately retired.
const MINIMUM_EXPECTED_READS = 22;

const DECLARATION = /\b(?:const|let)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*await\s/g;

/** Is this awaited statement one of the two read shapes that fail open? */
function isFailOpenRead(statement) {
  if (/\.single\(\)/.test(statement)) return false;
  if (/\.maybeSingle\(\)/.test(statement)) return true;
  return /\.select\(/.test(statement);
}

/** The identifier an `{ ..., error: alias }` / `{ ..., error }` binding puts the error in. */
function errorBindingIn(pattern) {
  const aliased = pattern.match(/\berror\s*:\s*([A-Za-z_$][\w$]*)/);
  if (aliased) return aliased[1];
  return /\berror\b\s*(?:,|\})/.test(pattern) ? "error" : null;
}

/**
 * Blank the body of every `catch (<name>)` block so the shadowing parameter, and every mention of
 * it inside the block, cannot pass for a read of an outer binding of the same name. Offsets are
 * preserved (each blanked character becomes a space), so an index into the result indexes the
 * original. An unbalanced block leaves the text untouched rather than guessing.
 */
export function blankCatchBlocks(source, name) {
  const re = new RegExp(String.raw`\bcatch\s*\(\s*${name}\b[^)]*\)\s*\{`, "g");
  let out = source;
  for (const match of source.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) continue;
    out = out.slice(0, match.index) + out.slice(match.index, close + 1).replace(/[^\n]/g, " ") + out.slice(close + 1);
  }
  return out;
}

/**
 * Whether a destructuring pattern binds `name` as an identifier: `{ error }`, `{ data, error }`,
 * `{ error = null }` or `{ err: error }` do; `{ error: other }` binds `other`, so it does not.
 */
export function patternBinds(pattern, name) {
  const body = pattern.slice(1, -1);
  return new RegExp(String.raw`(?:^|[{,:])\s*${name}\s*(?:[,}=]|$)`).test(body)
    || new RegExp(String.raw`:\s*${name}\s*(?:[,}=]|$)`).test(body);
}

/**
 * Index of the first re-declaration of `name` (a new binding), or the text length if none. Only a
 * declaration that binds the identifier counts: a property key that aliases it to another name
 * leaves the outer binding in scope.
 */
export function rebindIndex(source, name) {
  const re = /\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=/g;
  for (const match of source.matchAll(re)) {
    const target = match[1];
    const binds = target.startsWith("{") ? patternBinds(target, name) : target === name;
    if (binds) return match.index;
  }
  return source.length;
}

/**
 * Reads whose `error` is never bound, or is bound and then never mentioned again.
 * Returns `{ line, binding, reason }` for each.
 */
export function findUncheckedReads(source) {
  const findings = [];
  let reads = 0;
  DECLARATION.lastIndex = 0;
  let match;
  while ((match = DECLARATION.exec(source)) !== null) {
    // A PostgREST chain contains no bare semicolons, so the next one ends the statement.
    const end = source.indexOf(";", match.index);
    const statement = source.slice(match.index, end === -1 ? source.length : end + 1);
    if (!isFailOpenRead(statement)) continue;
    reads += 1;
    const binding = match[1];
    const line = source.slice(0, match.index).split("\n").length;
    const after = source.slice(end === -1 ? source.length : end + 1);
    // Only text where the name still means THIS binding counts as a read of it. Searching the
    // whole remainder let an unrelated later `catch (error)` or a second
    // `const { data: d2, error } = ...` destructure certify a read whose own error was dropped --
    // the exact fail-open shape (RLS denial read as "no such record") this gate exists for.
    // A catch parameter shadows only inside its own block, so that block is blanked and the
    // search continues past it (a real `if (error)` after the try/catch is still a read); a
    // re-declaration ends the search, since everything after it names the new binding.
    const scopeOf = (name) => {
      const blanked = blankCatchBlocks(after, name);
      return blanked.slice(0, rebindIndex(blanked, name));
    };
    if (binding.startsWith("{")) {
      const errorName = errorBindingIn(binding);
      if (!errorName) {
        findings.push({ line, binding, reason: "destructures data without error" });
        continue;
      }
      if (!new RegExp(`\\b${errorName}\\b`).test(scopeOf(errorName))) {
        findings.push({ line, binding, reason: `binds ${errorName} but never reads it` });
      }
    } else if (!new RegExp(`\\b${binding}\\.error\\b`).test(scopeOf(binding))) {
      findings.push({ line, binding, reason: `never reads ${binding}.error` });
    }
  }
  return { findings, reads };
}

if (process.argv.includes("--self-test")) {
  const cases = [
    // Guarded: destructured error, then read.
    ['const { data, error: e } = await c.from("t").select("*").limit(1).maybeSingle();\nif (e) return x;', 0],
    // Guarded: plain `error` binding, then read.
    ['const { data, error } = await c.from("t").select("*").limit(1).maybeSingle();\nif (error) return x;', 0],
    // Guarded: identifier binding whose .error is read.
    ['const r = await c.from("t").select("*").limit(1).maybeSingle();\nif (r.error) return x;', 0],
    // THE DEFECT this gate exists for: maybeSingle read for `data` alone.
    ['const { data } = await c.from("t").select("*").limit(1).maybeSingle();\nexisting = data;', 1],
    // The same defect on an identifier binding.
    ['const legacy = await c.from("t").select("*").limit(1).maybeSingle();\nmatch = legacy.data;', 1],
    // The ledger load: a list select, no terminator, error dropped.
    ['const { data: rows } = await c.from("data_import_rows").select("row_number").eq("job_id", j);', 1],
    // Bound and then abandoned -- the binding alone is not the guard.
    ['const { data, error: e } = await c.from("t").select("*").limit(1).maybeSingle();\nexisting = data;', 1],
    // The plain-name form of the same abandonment: a later, unrelated `error` (a catch clause or a
    // second destructure) is not a read of this one.
    ['const { data, error } = await c.from("t").select("*").limit(1).maybeSingle();\nexisting = data;\ntry { x(); } catch (error) { log(error); }', 1],
    // A catch parameter shadows only its own block: a read after the try/catch is still a read.
    ['const { data, error } = await c.from("t").select("*").limit(1).maybeSingle();\ntry { x(); } catch (error) { log(error); }\nif (error) return x;', 0],
    ['const { data, error } = await c.from("t").select("*").limit(1).maybeSingle();\ntry { x(); } catch (error) { if (error) { log({ nested: error }); } }\nif (error) return x;', 0],
    // A property key aliased to another name does not rebind `error`; a declaration inside the
    // shadowing catch block is that block's own and does not end the outer scope either.
    ['const { data, error } = await c.from("t").select("*").limit(1).maybeSingle();\nconst { error: other } = await d();\nif (error) return x;', 0],
    ['const { data, error } = await c.from("t").select("*").limit(1).maybeSingle();\ntry { x(); } catch (error) { const error2 = error; let error = null; }\nif (error) return x;', 0],
    // An alias TO `error` is a new binding of it.
    ['const { data, error } = await c.from("t").select("*").limit(1).maybeSingle();\nexisting = data;\nconst { err: error } = await d();\nif (error) return x;', 1],
    ['const { data, error } = await c.from("t").select("*").limit(1).maybeSingle();\nexisting = data;\nconst { data: d2, error } = await c.from("u").select("*").limit(1).maybeSingle();\nif (error) return x;', 1],
    // Reading the binding before it is rebound is still a read.
    ['const { data, error } = await c.from("t").select("*").limit(1).maybeSingle();\nif (error) return x;\nconst { data: d2, error } = await c.from("u").select("*").limit(1).maybeSingle();\nif (error) return y;', 0],
    ['const r = await c.from("t").select("*").limit(1).maybeSingle();\nmatch = r.data;\nconst r = other();\nif (r.error) return x;', 1],
    // `.single()` is exempt: it errors on no-row, so the null check below refuses either way.
    ['const { data: p } = await c.from("profiles").select("role").eq("id", u).single();\nif (!p) return x;', 0],
    // A write that returns its row is a `.single()` too, and its error is handled by the caller.
    ['const res = await c.from("t").insert(p).select("id").single();\ndata = res.data;', 0],
    // A builder-variable read: the `.select(` is on an earlier line, `.maybeSingle()` still catches it.
    ['const { data } = await q.order("created_at").limit(1).maybeSingle();\nexisting = data;', 1],
    ['const { data, error: e } = await q.order("created_at").limit(1).maybeSingle();\nif (e) return x;', 0],
    // An rpc call is neither shape -- it has no `.select(` and no `.maybeSingle()`.
    ['const { data } = await c.rpc("start_job", { p: 1 });', 0],
  ];
  let failures = 0;
  for (const [source, expected] of cases) {
    const actual = findUncheckedReads(source).findings.length;
    if (actual !== expected) {
      failures += 1;
      process.stderr.write(`self-test failed: ${JSON.stringify(source)} -> ${actual}, expected ${expected}\n`);
    }
  }
  if (failures) throw new Error(`Import lookup-error self-test failed (${failures} case(s)).`);
  process.stdout.write(`Import lookup-error self-test passed (${cases.length} cases).\n`);
  process.exit(0);
}

const importers = (await readdir(FUNCTIONS_DIR, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("bulk-import-"))
  .map((entry) => entry.name)
  .sort();

const problems = [];
let totalReads = 0;
for (const name of importers) {
  const file = path.join(FUNCTIONS_DIR, name, "index.ts");
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch {
    continue;
  }
  const { findings, reads } = findUncheckedReads(source);
  totalReads += reads;
  for (const finding of findings) {
    problems.push(
      `supabase/functions/${name}/index.ts:${finding.line}: ${finding.reason} -- ${finding.binding.replace(/\s+/g, " ")}`,
    );
  }
}

if (!importers.length) {
  throw new Error("No bulk-import-* functions found. The scan resolved nothing, so it proves nothing.");
}
if (totalReads < MINIMUM_EXPECTED_READS) {
  throw new Error(
    `Only ${totalReads} importer read(s) matched (expected at least ${MINIMUM_EXPECTED_READS}). `
    + "The scanner is probably broken -- a pass this thin proves nothing.",
  );
}
if (problems.length) {
  throw new Error(
    "A CSV importer reads a lookup's data without handling its error. A failed lookup then looks "
    + "like a missing record: the row is reported as unknown, or applied as a duplicate create.\n"
    + problems.join("\n"),
  );
}
process.stdout.write(
  `Import lookup-error check passed (${totalReads} read(s) across ${importers.length} importer(s)).\n`,
);
