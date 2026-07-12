import { readdir } from "node:fs/promises";
import { join } from "node:path";
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

const entrypoints = await findEntrypoints(join(process.cwd(), "supabase", "functions"));
if (entrypoints.length === 0) {
  console.log("No Supabase Edge Function entrypoints found.");
  process.exit(0);
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
