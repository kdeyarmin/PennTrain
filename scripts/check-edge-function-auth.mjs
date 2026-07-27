import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Every edge function with `verify_jwt = false` must declare, and demonstrably have, its own gate.
//
// 31 of this project's 60 edge functions set `verify_jwt = false` in supabase/config.toml. That is
// not a mistake -- pg_net sends no user JWT to a cron worker, Stripe sends no JWT to a webhook, and
// a resident's designated person has no account at all -- but it means the API gateway lets the
// request through and the function itself is the only thing between the internet and a service-role
// client. Nothing checked that the function actually had a gate. check-edge-functions.mjs type-
// checks, lints, tests and ratchets runtime-test coverage; none of that reads an auth path.
//
// All 31 do currently authenticate. The reason this exists anyway is what it took to establish
// that: they authenticate in seven different vocabularies --
//
//   requireCronRequest(...)              the shared cron-secret helper
//   secretsMatch(...)                    an inline constant-time compare in provision-demo-tenant
//   Stripe / SendGrid / Twilio verifiers  three unrelated webhook signature schemes
//   parsePhase2ApiCredential / SCIM      partner API credentials, hashed and compared
//   a uuid token in the query string     evidence-guest-download, unsubscribe-updates
//   Turnstile                            the public marketing forms
//   nothing at all, on purpose           get-platform-status, report-client-error
//
// -- so a grep for any one of them reports the other six as unauthenticated. Auditing this by grep
// produced four false positives on the first pass and one more on the second, every time because
// the gate sat one import hop away or used a name the pattern did not know. An auditor that cannot
// tell "no gate" from "a gate I do not recognise" is the thing being replaced here.
//
// The registry (scripts/edge-function-auth.json) records the gate per function and a rationale.
// Rule 3 below is what keeps it from becoming a wish: a declared gate must still be reachable in
// the function's own import closure, so a gate that gets deleted fails CI even though the
// declaration still claims it.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const FUNCTIONS_DIR = join(ROOT, "supabase/functions");
const CONFIG_PATH = join(ROOT, "supabase/config.toml");
const REGISTRY_PATH = join(SCRIPT_DIR, "edge-function-auth.json");

// A gate is proven by any one of its markers appearing anywhere in the function's transitive local
// import closure. Every marker is the INBOUND verification call, chosen after reading the function
// that performs it -- never a header name or a credential. `Authorization`, `apikey`, `Bearer` and
// `SERVICE_ROLE` appear overwhelmingly as OUTBOUND values on requests these functions make, so
// matching them would pass almost everything.
//
// The first draft of this table used `crypto.subtle.importKey` for webhook-signature and matched six
// functions that only ever SIGN outbound requests -- it would have certified fhir-writeback as
// signature-gated when its real gate is the cron secret. A marker that matches the wrong direction
// is worse than no check at all, because it produces a registry that reads as reviewed.
export const GATE_MARKERS = {
  "cron-secret": ["requireCronRequest"],
  "shared-secret": ["secretsMatch("],
  "webhook-signature": ["verifyPhase2StripeSignature", "verifySignature(", "validateRequest(", "new Webhook("],
  "api-credential": ["parsePhase2ApiCredential", "parseScimAuthorization"],
  "user-jwt": ["auth.getUser(", "getUser("],
  "guest-token": ["unsubscribe_token", "p_token", "token_sha256", "UUID_RE"],
  "turnstile": ["verifyTurnstile", "TURNSTILE"],
  // Deliberately reachable with no credential. Requires a rationale like every other entry, and is
  // the one gate with no marker to prove -- which is exactly why it must be written down.
  "public": [],
};

/** Read `[functions.NAME] ... verify_jwt = BOOL` pairs out of config.toml. */
export function parseVerifyJwt(configToml) {
  const declared = new Map();
  const re = /\[functions\.([a-z0-9-]+)\]\s*\n(?:[^[]*?)verify_jwt\s*=\s*(true|false)/g;
  for (const match of configToml.matchAll(re)) {
    declared.set(match[1], match[2] === "true");
  }
  return declared;
}

/**
 * Blank out the head of a declaration so a marker is only ever matched at a USE site.
 *
 * Without this the check is vacuous, and it was: the first version searched the raw closure, so
 * `requireCronRequest` matched its own `export function requireCronRequest` inside
 * _shared/cronAuth.ts. Any function that imported that module for anything at all -- most of them
 * import withCronCorsHeader from it -- was certified as cron-gated. Renaming the actual call in
 * run-data-lifecycle's handler still passed, which is how this was found.
 */
export function blankDeclarationHeads(source) {
  return source.replace(
    /\b(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
    (match) => " ".repeat(match.length),
  );
}

/** Resolve a function's transitive closure over RELATIVE imports only. */
async function importClosure(entrypoint) {
  const seen = new Set();
  const queue = [entrypoint];
  const sources = [];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // a bare or remote specifier that resolved to nothing local
    }
    sources.push(blankDeclarationHeads(text));
    for (const match of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
      queue.push(resolve(dirname(file), match[1]));
    }
  }
  return sources.join("\n");
}

/** True when at least one of the gate's markers appears in the source blob. */
export function gateIsProven(gate, blob) {
  const markers = GATE_MARKERS[gate];
  if (!markers) return false;
  if (markers.length === 0) return true; // "public" has nothing to prove
  return markers.some((marker) => blob.includes(marker));
}

export function validateRegistryShape(registry, declared) {
  const problems = [];
  // Keys beginning with `_` are documentation, not entries.
  const entries = Object.entries(registry).filter(([name]) => !name.startsWith("_"));
  const names = new Set(entries.map(([name]) => name));
  for (const [name, entry] of entries) {
    if (!declared.has(name)) {
      problems.push(`${name}: registry entry for a function that is not declared in config.toml`);
      continue;
    }
    if (declared.get(name) === true) {
      problems.push(`${name}: registry entry for a function whose verify_jwt is true -- the gateway already authenticates it, so remove the entry`);
      continue;
    }
    const gates = Array.isArray(entry?.gates) ? entry.gates : null;
    if (!gates || gates.length === 0) {
      problems.push(`${name}: registry entry has no \`gates\` array`);
      continue;
    }
    for (const gate of gates) {
      if (!(gate in GATE_MARKERS)) {
        problems.push(`${name}: unknown gate \`${gate}\` (known: ${Object.keys(GATE_MARKERS).join(", ")})`);
      }
    }
    if (typeof entry.rationale !== "string" || entry.rationale.trim() === "") {
      problems.push(`${name}: registry entry has no written rationale`);
    }
  }
  for (const [name, verifies] of declared) {
    if (verifies === false && !names.has(name)) {
      problems.push(`${name}: verify_jwt is false but there is no entry in edge-function-auth.json -- declare how the request is authenticated`);
    }
  }
  return problems;
}

const SELF_TEST_CASES = [
  {
    name: "a gate is proven by its marker",
    run: () => gateIsProven("cron-secret", 'import { requireCronRequest } from "../_shared/cronAuth.ts";') === true,
  },
  {
    name: "a gate is NOT proven by an outbound credential",
    run: () => gateIsProven("cron-secret", 'headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }') === false,
  },
  {
    name: "a marker at its own definition site does NOT prove the gate",
    run: () => gateIsProven("cron-secret", blankDeclarationHeads("export function requireCronRequest(req) {}")) === false,
  },
  {
    name: "but a call site still does",
    run: () => gateIsProven("cron-secret", blankDeclarationHeads("export function requireCronRequest(r) {}\nconst e = requireCronRequest(req, H);")) === true,
  },
  {
    name: "an inline non-exported helper is proven by its call, not its declaration",
    run: () => gateIsProven("shared-secret", blankDeclarationHeads("async function secretsMatch(a, b) {}")) === false
            && gateIsProven("shared-secret", blankDeclarationHeads("async function secretsMatch(a,b){}\nawait secretsMatch(x, y);")) === true,
  },
  {
    name: "public needs no marker",
    run: () => gateIsProven("public", "") === true,
  },
  {
    name: "an unknown gate is never proven",
    run: () => gateIsProven("vibes", "requireCronRequest") === false,
  },
  {
    name: "verify_jwt is parsed for both values",
    run: () => {
      const parsed = parseVerifyJwt("[functions.a]\nverify_jwt = true\n\n[functions.b]\n# note\nverify_jwt = false\n");
      return parsed.get("a") === true && parsed.get("b") === false;
    },
  },
  {
    name: "an unauthenticated function with no registry entry is a problem",
    run: () => validateRegistryShape({}, new Map([["x", false]])).length === 1,
  },
  {
    name: "an entry with no rationale is a problem",
    run: () => validateRegistryShape({ x: { gates: ["public"] } }, new Map([["x", false]])).length === 1,
  },
  {
    name: "an entry for a gateway-authenticated function is a problem",
    run: () => validateRegistryShape({ x: { gates: ["public"], rationale: "y" } }, new Map([["x", true]])).length === 1,
  },
  {
    name: "a complete entry is clean",
    run: () => validateRegistryShape({ x: { gates: ["cron-secret"], rationale: "y" } }, new Map([["x", false]])).length === 0,
  },
];

function runSelfTest() {
  const failures = SELF_TEST_CASES.filter((testCase) => testCase.run() !== true);
  for (const failure of failures) console.error(`✗ ${failure.name}`);
  if (failures.length > 0) {
    console.error(`\nEdge function auth self-test FAILED (${failures.length}/${SELF_TEST_CASES.length} cases).`);
    process.exit(1);
  }
  console.log(`Edge function auth self-test passed (${SELF_TEST_CASES.length} cases).`);
}

async function run() {
  runSelfTest();

  const [configToml, registryRaw] = await Promise.all([
    readFile(CONFIG_PATH, "utf8"),
    readFile(REGISTRY_PATH, "utf8"),
  ]);
  const declared = parseVerifyJwt(configToml);
  const registry = JSON.parse(registryRaw);

  const directories = (await readdir(FUNCTIONS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();

  const problems = [];

  // Rule 1: every function is declared. An undeclared function defaults to verify_jwt = true, which
  // is the safe direction, but it also means this audit never sees it -- and a later config edit
  // could flip it to false without ever passing through the registry.
  for (const name of directories) {
    if (!declared.has(name)) {
      problems.push(`${name}: no [functions.${name}] verify_jwt declaration in supabase/config.toml`);
    }
  }

  // Rule 2: the registry covers exactly the unauthenticated functions, with a rationale each.
  problems.push(...validateRegistryShape(registry, declared));

  // Rule 3: a declared gate must still be reachable. This is what stops the registry drifting into
  // a description of what the code used to do.
  for (const name of directories) {
    if (declared.get(name) !== false) continue;
    const entry = registry[name];
    if (!entry || !Array.isArray(entry.gates)) continue; // already reported by rule 2
    const blob = await importClosure(join(FUNCTIONS_DIR, name, "index.ts"));
    for (const gate of entry.gates) {
      if (!(gate in GATE_MARKERS)) continue; // already reported
      if (!gateIsProven(gate, blob)) {
        problems.push(
          `${name}: declares the \`${gate}\` gate, but none of its markers ` +
          `(${GATE_MARKERS[gate].join(", ")}) appear in its import closure`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error(`Edge function auth check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }

  const unauthenticated = [...declared.values()].filter((value) => value === false).length;
  console.log(
    `Edge function auth check passed (${directories.length} function(s); ` +
    `${unauthenticated} with verify_jwt=false, each with a declared and reachable gate).`,
  );
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

await run();
