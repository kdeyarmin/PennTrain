import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
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

async function checkFunctionConfig(functionsDir, configPath, entrypoints) {
  const functionNames = [...new Set(
    entrypoints
      .map((path) => relative(functionsDir, path))
      .filter((path) => !path.startsWith("_"))
      .map((path) => path.split(sep)[0]),
  )].sort();
  const config = await readFile(configPath, "utf8");
  const configuredNames = [...config.matchAll(/^\[functions\.([^\]]+)\]$/gm)]
    .map((match) => match[1])
    .sort();

  const missingConfig = functionNames.filter((name) => !configuredNames.includes(name));
  const missingDirectory = configuredNames.filter((name) => !functionNames.includes(name));
  if (missingConfig.length > 0 || missingDirectory.length > 0) {
    const details = [
      missingConfig.length > 0 ? `missing config.toml entries: ${missingConfig.join(", ")}` : null,
      missingDirectory.length > 0 ? `config.toml entries without a function directory: ${missingDirectory.join(", ")}` : null,
    ].filter(Boolean).join("; ");
    throw new Error(`Supabase Edge Function config drift: ${details}`);
  }
}

const functionsDir = join(process.cwd(), "supabase", "functions");
const entrypoints = await findEntrypoints(functionsDir);
if (entrypoints.length === 0) {
  console.log("No Supabase Edge Function entrypoints found.");
  process.exit(0);
}

try {
  // Every deployable function must have an explicit config block so verify_jwt
  // and deployment behavior are reviewed decisions rather than silent defaults.
  await checkFunctionConfig(functionsDir, join(process.cwd(), "supabase", "config.toml"), entrypoints);
  await runDeno(["check", "--node-modules-dir=auto", ...entrypoints]);
  const tests = await findTests(functionsDir);
  const functionDirectories = new Set(entrypoints.map((entrypoint) => dirname(entrypoint)));
  const runtimeTestedDirectories = new Set(
    tests.map((test) => dirname(test)).filter((directory) => functionDirectories.has(directory)),
  );
  console.log(
    `Edge handler runtime tests: ${runtimeTestedDirectories.size}/${functionDirectories.size} functions`,
  );
  if (runtimeTestedDirectories.size < 3) {
    throw new Error("Edge handler runtime test coverage regressed below the established minimum of 3 functions");
  }
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
