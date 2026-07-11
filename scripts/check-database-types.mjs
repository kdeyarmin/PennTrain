import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const checkedInPath = "artifacts/caremetric-train/src/lib/database.types.ts";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const generated = spawnSync(
  npx,
  ["--yes", "supabase@2.109.1", "gen", "types", "typescript", "--local"],
  { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
);

if (generated.status !== 0) {
  process.stderr.write(generated.stderr || generated.stdout);
  throw new Error("Supabase database type generation failed");
}

const normalize = (value) => value.replace(/\r\n/g, "\n").trimEnd() + "\n";
const checkedIn = normalize(await readFile(checkedInPath, "utf8"));
const actual = normalize(generated.stdout);

if (checkedIn !== actual) {
  const checkedLines = checkedIn.split("\n");
  const actualLines = actual.split("\n");
  const mismatch = checkedLines.findIndex(
    (line, index) => line !== actualLines[index],
  );
  throw new Error(
    `Generated database types differ from ${checkedInPath} near line ${mismatch + 1}. ` +
      "Regenerate the file from a reset local stack before release.",
  );
}

console.log("Generated database types match the checked-in file.");
