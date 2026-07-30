#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requiredStartupFiles = [
  ".node-version",
  ".nvmrc",
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "railpack.json",
];
const services = [
  {
    name: "caremetric-carebase",
    configPath: "railway.json",
    packagePath: "artifacts/caremetric-carebase/package.json",
    entryPath: "artifacts/caremetric-carebase/server/index.mjs",
    builtEntryPath: "artifacts/caremetric-carebase/dist/public/index.html",
    startCommand: "exec node artifacts/caremetric-carebase/server/index.mjs",
    packageStart: "node server/index.mjs",
  },
  {
    name: "voice-gateway",
    configPath: "artifacts/voice-gateway/railway.json",
    packagePath: "artifacts/voice-gateway/package.json",
    entryPath: "artifacts/voice-gateway/src/index.ts",
    builtEntryPath: "artifacts/voice-gateway/dist/index.js",
    startCommand: "exec node artifacts/voice-gateway/dist/index.js",
    packageStart: "node dist/index.js",
  },
];

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

await Promise.all(requiredStartupFiles.map(async (path) => {
  try {
    await access(resolve(root, path));
  } catch (error) {
    throw new Error(`Required startup file is missing: ${path}`, { cause: error });
  }
}));

async function getOpenPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose, rejectClose) => server.close((error) => {
    if (error) rejectClose(error);
    else resolveClose();
  }));
  if (!port) throw new Error("Could not allocate a startup-check port");
  return port;
}

async function waitForHealth(service, child) {
  const deadline = Date.now() + 10_000;
  let lastError = "server did not respond";
  while (Date.now() < deadline) {
    if (child.startupError) throw child.startupError;
    if (child.exitCode !== null) {
      throw new Error(`${service.name} exited before becoming healthy (exit ${child.exitCode})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${service.port}/health`);
      const body = await response.json();
      if (response.ok && (body.status === "ok" || body.ok === true)) return;
      lastError = `HTTP ${response.status}: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`${service.name} healthcheck timed out: ${lastError}`);
}

async function terminate(child) {
  if (!child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(false), 5_000)),
  ]);
  if (graceful || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await exited;
}

async function checkService(service) {
  service.port = await getOpenPort();
  const [railway, packageJson] = await Promise.all([
    readJson(service.configPath),
    readJson(service.packagePath),
  ]);
  await Promise.all([
    access(resolve(root, service.entryPath)),
    access(resolve(root, service.builtEntryPath)),
  ]);
  if (railway.deploy?.startCommand !== service.startCommand) {
    throw new Error(`${service.configPath} must start with ${JSON.stringify(service.startCommand)}`);
  }
  if (railway.deploy?.healthcheckPath !== "/health") {
    throw new Error(`${service.configPath} must declare /health as its healthcheckPath`);
  }
  if (packageJson.scripts?.start !== service.packageStart) {
    throw new Error(
      `${service.packagePath} must define start as ${JSON.stringify(service.packageStart)}`,
    );
  }

  const executable = service.startCommand.replace(/^exec node /, "");
  const child = spawn(process.execPath, [executable], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(service.port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.once("error", (error) => { child.startupError = error; });
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-16_384); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-16_384); });
  try {
    await waitForHealth(service, child);
    console.log(`Startup check passed: ${service.name}`);
  } catch (error) {
    throw new Error(`${error.message}\n${output.trim()}`, { cause: error });
  } finally {
    await terminate(child);
  }
}

for (const service of services) await checkService(service);
