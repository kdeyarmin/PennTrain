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

const entrypoints = await findEntrypoints(join(process.cwd(), "supabase", "functions"));
if (entrypoints.length === 0) {
  console.log("No Supabase Edge Function entrypoints found.");
  process.exit(0);
}

const child = spawn("deno", ["check", "--node-modules-dir=auto", ...entrypoints], { stdio: "inherit" });

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error("Deno is required. Use the repo dev container or install Deno 2.x locally.");
    process.exit(127);
  }
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`deno check terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
