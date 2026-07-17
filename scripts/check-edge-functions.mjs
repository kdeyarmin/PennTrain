import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { spawn } from "node:child_process";

async function findEntrypoints(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await findEntrypoints(fullPath));
    } else if (entry.isFile() && entry.name === "index.ts") {
      paths.push(fullPath);
    }
  }

  return paths.sort();
}

async function findTests(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await findTests(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      paths.push(fullPath);
    }
  }

  return paths.sort();
}

function runDeno(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("deno", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`deno ${args[0]} terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`deno ${args[0]} exited with status ${code ?? 1}`));
    });
  });
}

const functionsDir = join(process.cwd(), "supabase", "functions");
const entrypoints = await findEntrypoints(functionsDir);
if (entrypoints.length === 0) {
  console.log("No Supabase Edge Function entrypoints found.");
  process.exit(0);
}

// Every deployable function must have an explicit [functions.<name>] block in config.toml so
// its verify_jwt setting is a reviewed decision rather than a silent gateway default, and so
// the Supabase GitHub integration deploys it.
const functionNames = [...new Set(
  entrypoints
    .map((path) => relative(functionsDir, path))
    .filter((path) => !path.startsWith("_"))
    .map((path) => path.split(sep)[0]),
)].sort();
const configToml = await readFile(join(process.cwd(), "supabase", "config.toml"), "utf8");
const declared = new Set(
  [...configToml.matchAll(/^\[functions\.([A-Za-z0-9_-]+)\]/gm)].map((match) => match[1]),
);
const undeclared = functionNames.filter((name) => !declared.has(name));
if (undeclared.length > 0) {
  console.error(
    `Edge Functions missing a [functions.<name>] declaration in supabase/config.toml: ${undeclared.join(", ")}`,
  );
  process.exit(1);
}
const stale = [...declared].filter((name) => !functionNames.includes(name)).sort();
if (stale.length > 0) {
  console.warn(`config.toml declares functions with no matching directory: ${stale.join(", ")}`);
}

try {
  await runDeno(["check", "--node-modules-dir=auto", ...entrypoints]);
  const tests = await findTests(join(process.cwd(), "supabase", "functions"));
  if (tests.length > 0) {
    await runDeno(["test", "--node-modules-dir=auto", ...tests]);
  }
} catch (error) {
  if (error.code === "ENOENT") {
    console.error("Deno is required. Use the repo dev container or install Deno 2.x locally.");
    process.exit(127);
  }
  console.error(error);
  process.exit(1);
}
