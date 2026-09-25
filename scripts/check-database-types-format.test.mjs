import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const checker = fileURLToPath(new URL("./check-database-types-format.mjs", import.meta.url));
const fixture = `export type Database = {
  public: {
    Tables: {
      example: {
        Row: {
          id: string
        }
        Insert: {
          id?: string
        }
        Update: {
          id?: string
        }
        Relationships: []
      }
    }
  }
}
`;

function check(source) {
  const directory = mkdtempSync(join(tmpdir(), "carebase-types-format-"));
  try {
    const file = join(directory, "artifacts/caremetric-carebase/src/lib/database.types.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    return spawnSync(process.execPath, [checker], { cwd: directory, encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const [name, newline] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
  test(`validates table columns with ${name} line endings`, () => {
    const result = check(fixture.replaceAll("\n", newline));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 table\/view entries validated/);
  });

  test(`rejects mismatched table columns with ${name} line endings`, () => {
    const result = check(fixture.replace("id?: string", "other?: string").replaceAll("\n", newline));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Insert is missing 1 column/);
  });
}

test("fails closed when the file contains no recognized schema entries", () => {
  const result = check("export type Database = {};\r\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no table\/view entries were recognized/);
});
