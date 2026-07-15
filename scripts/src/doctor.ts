import { spawnSync } from "node:child_process";
import { extname } from "node:path";

const args = new Set(process.argv.slice(2));
const includeNetwork = args.has("--network");
const strict = args.has("--strict");

type CheckStatus = "pass" | "warn" | "fail";

type Check = {
  name: string;
  status: CheckStatus;
  detail: string;
};

function run(
  command: string,
  args: string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  let executable = command;
  let executableArgs = args;

  if (process.platform === "win32" && !extname(command)) {
    const lookup = spawnSync("where.exe", [command], { encoding: "utf8" });
    const resolved = (lookup.stdout ?? "")
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .find((candidate) => [".exe", ".com", ".cmd", ".bat"].includes(extname(candidate).toLowerCase()));
    if (resolved) executable = resolved;
  }

  // Node cannot execute Windows .cmd/.bat package-manager shims directly.
  // Invoke only the already-resolved fixed command through cmd.exe; this avoids
  // shell lookup ambiguity and the spawn `shell: true` argument-concatenation warning.
  if (process.platform === "win32" && [".cmd", ".bat"].includes(extname(executable).toLowerCase())) {
    const shim = executable;
    executable = process.env.ComSpec ?? "cmd.exe";
    executableArgs = ["/d", "/c", "call", shim, ...args];
  }

  const result = spawnSync(executable, executableArgs, { encoding: "utf8" });
  return {
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? result.error?.message ?? "").trim(),
  };
}

function commandVersion(
  name: string,
  command: string,
  args: string[] = ["--version"],
  missingStatus: CheckStatus = "fail",
): Check {
  const result = run(command, args);
  const output = result.stdout || result.stderr;
  return {
    name,
    status: result.status === 0 ? "pass" : missingStatus,
    detail: output || `Unable to execute ${command}`,
  };
}

function firstAvailableBrowser(): Check {
  const candidates = [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "firefox",
  ];
  for (const candidate of candidates) {
    const lookup = process.platform === "win32"
      ? run("where.exe", [candidate])
      : run("sh", ["-lc", `command -v ${candidate}`]);
    if (lookup.status === 0 && lookup.stdout) {
      const version = run(candidate, ["--version"]);
      return {
        name: "Browser binary",
        status: "pass",
        detail: `${lookup.stdout} (${version.stdout || version.stderr || "version unavailable"})`,
      };
    }
  }

  return {
    name: "Browser binary",
    status: "warn",
    detail:
      "No Chromium/Chrome/Firefox binary found. Browser screenshots and E2E tests will be skipped until one is installed.",
  };
}

function registryReachable(): Check {
  const result = run("npm", [
    "view",
    "pnpm",
    "version",
    "--registry=https://registry.npmjs.org/",
  ]);
  return {
    name: "npm registry access",
    status: result.status === 0 ? "pass" : "warn",
    detail: result.stdout || result.stderr || "Unable to query npm registry",
  };
}

function aptAvailable(): Check {
  const result = run("apt-get", ["--version"]);
  return {
    name: "apt-get availability",
    status: result.status === 0 ? "pass" : "warn",
    detail:
      result.stdout.split("\n")[0] ||
      result.stderr ||
      "apt-get is not available in this environment",
  };
}

function aptReachable(): Check {
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    return {
      name: "apt repository access",
      status: "warn",
      detail:
        "Skipping `apt-get update` because it typically requires root. Re-run with sudo to test apt repository access.",
    };
  }

  const result = run("apt-get", ["update", "-o", "Debug::NoLocking=1"]);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    name: "apt repository access",
    status: result.status === 0 ? "pass" : "warn",
    detail:
      output.split("\n").slice(-8).join("\n") || "Unable to run apt-get update",
  };
}

const checks: Check[] = [
  commandVersion("Node.js", "node", ["--version"]),
  commandVersion("pnpm", "pnpm", ["--version"]),
  commandVersion("npm", "npm", ["--version"]),
  commandVersion("Corepack", "corepack", ["--version"]),
  commandVersion("Deno", "deno", ["--version"], "warn"),
  commandVersion("Supabase CLI", "supabase", ["--version"], "warn"),
  firstAvailableBrowser(),
  aptAvailable(),
];

if (includeNetwork) {
  checks.push(registryReachable(), aptReachable());
}

let hasWarning = false;
let hasFailure = false;
for (const check of checks) {
  const marker =
    check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️" : "❌";
  console.log(`${marker} ${check.name}: ${check.detail}`);
  if (check.status === "warn") hasWarning = true;
  if (check.status === "fail") hasFailure = true;
}

if (!includeNetwork) {
  console.log(
    "\nTip: run `pnpm run doctor:network` to test npm and apt network access.",
  );
}

if (hasWarning) {
  console.log("\nWarnings were found, but local development checks completed.");
}

if (hasFailure || (strict && hasWarning)) {
  process.exitCode = 1;
}
