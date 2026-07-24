// Stands up a throwaway local Postgres cluster for the durable
// phone-store tests. Deliberately NOT a mock: claim-once races, the unique
// CallSid index, and TTL checks against the database clock only prove
// anything against a real server.
//
// Resolution order:
//   1. VOICE_PG_TEST_URL — point the tests at an existing database.
//   2. initdb/pg_ctl on PATH or under /usr/lib/postgresql/<v>/bin —
//      initdb a scratch cluster in a temp dir (running via `su postgres`
//      when the test process is root, since initdb refuses root).
//   3. Neither available — the caller skips the Postgres-backed tests.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export interface ScratchPostgres {
  url: string;
  stop(): void;
}

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

function findPgBinDir(): string | null {
  const envDir = process.env.PG_BIN_DIR;
  if (envDir && fs.existsSync(path.join(envDir, "initdb"))) return envDir;
  try {
    const onPath = execFileSync("which", ["initdb"], { stdio: "pipe" })
      .toString()
      .trim();
    if (onPath) return path.dirname(onPath);
  } catch {
    /* not on PATH */
  }
  const debianRoot = "/usr/lib/postgresql";
  try {
    const versions = fs
      .readdirSync(debianRoot)
      .filter((v) => /^\d+$/.test(v))
      .sort((a, b) => Number(b) - Number(a));
    for (const version of versions) {
      const bin = path.join(debianRoot, version, "bin");
      if (fs.existsSync(path.join(bin, "initdb"))) return bin;
    }
  } catch {
    /* no Debian layout */
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** initdb refuses to run as root; drop to the `postgres` system user. */
function makeRunner(asPostgres: boolean) {
  return (cmd: string, args: string[]): void => {
    if (asPostgres) {
      const line = [cmd, ...args].map(shellQuote).join(" ");
      execFileSync("su", ["postgres", "-c", line], { stdio: "pipe" });
    } else {
      execFileSync(cmd, args, { stdio: "pipe" });
    }
  };
}

export async function startScratchPostgres(): Promise<ScratchPostgres> {
  const external = process.env.VOICE_PG_TEST_URL;
  if (external) {
    return { url: external, stop: () => undefined };
  }

  const binDir = findPgBinDir();
  if (!binDir) {
    throw new Error("no initdb/pg_ctl found (install postgresql to run these)");
  }

  const asPostgres = typeof process.getuid === "function" && process.getuid() === 0;
  const run = makeRunner(asPostgres);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-gw-pg-"));
  const dataDir = path.join(dir, "data");
  const logFile = path.join(dir, "pg.log");
  if (asPostgres) {
    // The postgres user must own the cluster dir (and traverse its parents).
    fs.chmodSync(dir, 0o755);
    execFileSync("chown", ["postgres:postgres", dir], { stdio: "pipe" });
  }

  const port = await freePort();
  const pgCtl = path.join(binDir, "pg_ctl");
  try {
    run(path.join(binDir, "initdb"), [
      "-D",
      dataDir,
      "-U",
      "postgres",
      "--auth=trust",
      "--no-sync",
    ]);
    run(pgCtl, [
      "-D",
      dataDir,
      "-l",
      logFile,
      "-w",
      "-o",
      // Scratch cluster: local only, durability off for speed, unix socket
      // kept inside the temp dir so nothing global is touched.
      `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`,
      "start",
    ]);
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    stop() {
      try {
        run(pgCtl, ["-D", dataDir, "-m", "immediate", "stop"]);
      } catch {
        /* already down */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
