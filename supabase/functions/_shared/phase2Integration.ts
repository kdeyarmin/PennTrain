export const PHASE2_INTEGRATION_SCHEMA_VERSION = "2026-07-11";
export const PHASE2_INTEGRATION_REPLAY_WINDOW_SECONDS = 300;

// Per-command envelope contracts for the integration gateway (PT-003).
// The database is the source of truth:
//   - registered command versions live in public.integration_schema_definitions
//     (schema_kind = 'command'), seeded by
//     supabase/migrations/20260711200651_phase2_signed_integration_hub.sql and
//     supabase/migrations/20260714210309_medication_integration_boundary.sql;
//   - scope enforcement lives in public.accept_integration_command
//     (create-or-replaced in
//     supabase/migrations/20260724230000_per_command_integration_contracts.sql).
// Keep this map in sync with both. Commands absent from this map use the
// generic baseline contract (PHASE2_INTEGRATION_SCHEMA_VERSION + commands:write).
export const PHASE2_INTEGRATION_COMMAND_CONTRACTS: Readonly<
  Record<string, { schemaVersion: string; requiredScope: string }>
> = {
  "medication.snapshot.import": { schemaVersion: "2026-07-14", requiredScope: "medications:write" },
  "fhir.bundle.import": { schemaVersion: "2026-07-25", requiredScope: "commands:write" },
};

export function phase2CommandContract(
  commandType: string,
): { schemaVersion: string; requiredScope: string } {
  return PHASE2_INTEGRATION_COMMAND_CONTRACTS[commandType] ??
    { schemaVersion: PHASE2_INTEGRATION_SCHEMA_VERSION, requiredScope: "commands:write" };
}

// Scopes that may submit the named command, most specific first. commands:write
// stays the superset scope accepted for every command, matching
// public.accept_integration_command.
export function phase2CommandScopeCandidates(commandType: string): string[] {
  const contract = phase2CommandContract(commandType);
  return contract.requiredScope === "commands:write"
    ? ["commands:write"]
    : [contract.requiredScope, "commands:write"];
}

// Null when the envelope version matches the command's registered version;
// otherwise a response-ready message naming the expected version.
export function phase2CommandSchemaVersionError(
  commandType: string,
  schemaVersion: unknown,
): string | null {
  const expected = phase2CommandContract(commandType).schemaVersion;
  return schemaVersion === expected
    ? null
    : `Command '${commandType}' requires schemaVersion '${expected}'`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function phase2IntegrationSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function phase2IntegrationHmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(result));
}

export function phase2IntegrationConstantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

export async function signPhase2IntegrationWebhook(
  secret: string,
  webhookId: string,
  timestamp: number,
  rawBody: string,
): Promise<string> {
  return phase2IntegrationHmac(secret, `${webhookId}.${timestamp}.${rawBody}`);
}

/**
 * The `Webhook-Signature` header value: one `v1=` signature per live secret, space separated.
 *
 * Rotation writes a previous secret with a validity window, and until now nothing ever sent a
 * signature for it -- so the "grace window" the rotation dialog promises the operator did not
 * exist and every consumer had to cut over in the same instant the secret was minted. Sending both
 * is the whole mechanism: a consumer still holding the old secret keeps verifying until the window
 * closes. Nulls and blanks are dropped, so outside a rotation this is exactly one signature.
 */
export async function phase2IntegrationSignatureHeader(
  secrets: (string | null | undefined)[],
  webhookId: string,
  timestamp: number,
  rawBody: string,
): Promise<string> {
  const live = [...new Set(secrets.filter((secret): secret is string => !!secret && secret.length > 0))];
  const signatures = await Promise.all(
    live.map((secret) => signPhase2IntegrationWebhook(secret, webhookId, timestamp, rawBody)),
  );
  return signatures.map((signature) => `v1=${signature}`).join(" ");
}

export async function verifyPhase2IntegrationWebhook(input: {
  secret: string;
  webhookId: string;
  timestamp: number;
  rawBody: string;
  signature: string;
  nowSeconds?: number;
}): Promise<boolean> {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestamp) > PHASE2_INTEGRATION_REPLAY_WINDOW_SECONDS) return false;
  const expected = await signPhase2IntegrationWebhook(
    input.secret,
    input.webhookId,
    input.timestamp,
    input.rawBody,
  );
  // A rotating sender sends one signature per live secret, space separated (see
  // phase2IntegrationSignatureHeader), so a verifier matches against any of them rather than
  // against the header as a single opaque string.
  return input.signature.split(/\s+/).filter(Boolean).some((candidate) =>
    phase2IntegrationConstantTimeEqual(expected, candidate.startsWith("v1=") ? candidate.slice(3) : candidate)
  );
}

export function parsePhase2ApiCredential(authorization: string | null): string | null {
  // Keep accepting pre-rebrand cmt_live_ credentials until tenants rotate them.
  const match = authorization?.match(/^Bearer\s+((ccb_live_|cmt_live_)[0-9a-f]{12}\.[0-9a-f]{64})$/i);
  return match?.[1] ?? null;
}

export function phase2CredentialIsUsable(input: {
  status: string;
  expiresAt: string;
  scopes: string[];
  requiredScope: string;
}, now = Date.now()): boolean {
  return input.status === "active" && Date.parse(input.expiresAt) > now && input.scopes.includes(input.requiredScope);
}

export function encodePhase2Cursor(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid cursor sequence");
  return btoa(`v1:${sequence}`).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodePhase2Cursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const padded = cursor.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((cursor.length + 3) % 4);
    const decoded = atob(padded);
    const match = decoded.match(/^v1:([0-9]+)$/);
    const sequence = Number(match?.[1]);
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error();
    return sequence;
  } catch {
    throw new Error("Invalid cursor");
  }
}

export function phase2RetryableWebhookStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function phase2IntegrationHeaders(
  correlationId: string,
  rate?: { limit: number; remaining: number; resetAt: string },
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Version": PHASE2_INTEGRATION_SCHEMA_VERSION,
    "X-Correlation-Id": correlationId,
    Deprecation: "false",
    ...(rate
      ? {
        "RateLimit-Limit": String(rate.limit),
        "RateLimit-Remaining": String(rate.remaining),
        "RateLimit-Reset": String(Math.floor(Date.parse(rate.resetAt) / 1000)),
      }
      : {}),
  };
}

export function sanitizePhase2IntegrationError(value: unknown, maxLength = 500): string {
  const text = value instanceof Error ? value.message : String(value ?? "Unknown error");
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function phase2RoundRobinByTenant<T extends { organization_id: string }>(rows: T[]): T[] {
  const queues = new Map<string, T[]>();
  for (const row of rows) {
    const queue = queues.get(row.organization_id) ?? [];
    queue.push(row);
    queues.set(row.organization_id, queue);
  }
  const ordered: T[] = [];
  while (ordered.length < rows.length) {
    for (const queue of queues.values()) {
      const next = queue.shift();
      if (next) ordered.push(next);
    }
  }
  return ordered;
}

function parseCanonicalIpv4(value: string): number[] | null {
  const parts = value.split(".");
  // Leading zeros are not decimal here. `0177.0.0.1` is 127.0.0.1 to stacks that still
  // honor octal, and `Number("0177")` is 177, so the old check called that address public.
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => part > 255)) return null;
  return numbers;
}

function phase2PublicIpv4(value: string): boolean {
  const numbers = parseCanonicalIpv4(value);
  if (!numbers) return false;
  const [a, b] = numbers;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}

function expandIpv6(address: string): number[] | null {
  let value = address.toLowerCase();
  const embedded = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (embedded) {
    const numbers = parseCanonicalIpv4(embedded[2]);
    if (!numbers) return null;
    const hi = (numbers[0] << 8) | numbers[1];
    const lo = (numbers[2] << 8) | numbers[3];
    value = `${embedded[1]}${hi.toString(16)}:${lo.toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/.test(value) || value.includes(":::")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const groups = side.split(":");
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  };
  if (halves.length === 1) {
    const groups = parseSide(halves[0]);
    return groups && groups.length === 8 ? groups : null;
  }
  const left = parseSide(halves[0]);
  const right = parseSide(halves[1]);
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function embeddedIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function phase2PublicIp(value: string): boolean {
  const address = value.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!address.includes(":")) return phase2PublicIpv4(address);
  const groups = expandIpv6(address);
  if (!groups) return false;
  const [a, b, c, d, e, f, g, h] = groups;
  if (groups.every((part) => part === 0)) return false;
  if (groups.slice(0, 7).every((part) => part === 0) && h === 1) return false;
  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
  if ((a & 0xfe00) === 0xfc00) return false;
  if (a >= 0xfe80 && a <= 0xfebf) return false;
  if ((a & 0xff00) === 0xff00) return false;
  // 100::/16 discard, documentation, benchmarking, and ORCHID (2001:10::/28).
  if (a === 0x0100) return false;
  if (a === 0x2001 && (b === 0x0db8 || b === 0x0002 || (b >= 0x0010 && b <= 0x001f))) return false;
  // Local-use NAT64, the whole 64:ff9b:1::/48. The well-known prefix is checked below
  // so a public embedded IPv4 can still be reached and a private one cannot.
  if (a === 0x0064 && b === 0xff9b && c === 0x0001) return false;
  // IPv4-mapped ::ffff:0:0/96, including the expanded form 0:0:0:0:0:ffff:7f00:1
  // that the old `::ffff:` prefix check never saw.
  if (groups.slice(0, 5).every((part) => part === 0) && f === 0xffff) {
    return phase2PublicIpv4(embeddedIpv4(g, h));
  }
  // Well-known NAT64 64:ff9b::/96. The previous check only named 64:ff9b:1::/48.
  if (a === 0x0064 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return phase2PublicIpv4(embeddedIpv4(g, h));
  }
  // 6to4 2002::/16 carries an IPv4 in the next 32 bits.
  if (a === 0x2002) return phase2PublicIpv4(embeddedIpv4(b, c));
  return true;
}

export type Phase2DnsResolver = (hostname: string, recordType: "A" | "AAAA") => Promise<string[]>;

export async function validatePhase2WebhookDestination(
  value: string,
  resolver: Phase2DnsResolver = (hostname, recordType) => Deno.resolveDns(hostname, recordType),
): Promise<{ valid: boolean; reason?: string; addresses?: string[] }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { valid: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
    url.href.length > 2048 || url.hash) return { valid: false, reason: "unsafe_url" };
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { valid: false, reason: "unsafe_hostname" };
  }
  if (/^[0-9.]+$/.test(hostname) || hostname.includes(":")) {
    return phase2PublicIp(hostname)
      ? { valid: true, addresses: [hostname] }
      : { valid: false, reason: "non_public_address" };
  }
  const results = await Promise.allSettled([
    resolver(hostname, "A"),
    resolver(hostname, "AAAA"),
  ]);
  const addresses = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!addresses.length) return { valid: false, reason: "dns_resolution_failed" };
  if (addresses.some((address) => !phase2PublicIp(address))) {
    return { valid: false, reason: "non_public_address", addresses };
  }
  return { valid: true, addresses };
}

export type Phase2PinnedConnection = Pick<Deno.Conn, "read" | "write" | "close">;
export type Phase2PinnedConnector = (
  address: string,
  tlsHostname: string,
  port: number,
) => Promise<Phase2PinnedConnection>;

async function phase2DefaultPinnedConnector(
  address: string,
  tlsHostname: string,
  port: number,
): Promise<Phase2PinnedConnection> {
  const tcp = await Deno.connect({ hostname: address, port, transport: "tcp" });
  try {
    return await Deno.startTls(tcp, {
      hostname: tlsHostname,
      alpnProtocols: ["http/1.1"],
    });
  } catch (error) {
    tcp.close();
    throw error;
  }
}

function phase2TimeoutError() {
  return new DOMException("Webhook request timed out", "TimeoutError");
}

async function phase2BeforeDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw phase2TimeoutError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(phase2TimeoutError()), remaining);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function phase2WriteAll(
  connection: Phase2PinnedConnection,
  bytes: Uint8Array,
  deadline: number,
) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await phase2BeforeDeadline(connection.write(bytes.subarray(offset)), deadline);
    if (!written) throw new Error("Pinned webhook write failed");
    offset += written;
  }
}

function phase2ResponseHead(bytes: Uint8Array): { status: number; bodyStart: number; length: number | null } | null {
  // latin1 preserves one character per byte so offsets stay correct when a header or
  // body contains UTF-8. Decode the actual response body as UTF-8 only after framing it.
  const raw = new TextDecoder("latin1").decode(bytes);
  let start = 0;
  for (;;) {
    const end = raw.indexOf("\r\n\r\n", start);
    if (end < 0) {
      if (bytes.length > 32 * 1024) throw new Error("Webhook response headers too large");
      return null;
    }
    if (end + 4 > 32 * 1024) throw new Error("Webhook response headers too large");
    const lines = raw.slice(start, end).split("\r\n");
    const status = Number(lines.shift()?.match(/^HTTP\/1\.[01] ([0-9]{3})(?: |$)/)?.[1]);
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("Malformed webhook HTTP status");
    start = end + 4;
    // Continue/early-hints headers do not acknowledge the webhook. Await the final response.
    if (status === 101) throw new Error("Webhook protocol upgrade is not supported");
    if (status < 200) continue;
    const contentLengths = lines.filter((line) => /^content-length:/i.test(line))
      .map((line) => line.slice(line.indexOf(":") + 1).trim());
    const transferEncoded = lines.some((line) => /^transfer-encoding:/i.test(line));
    let length: number | null = null;
    if (!transferEncoded && contentLengths.length) {
      if (contentLengths.some((value) => !/^\d+$/.test(value) || value !== contentLengths[0])) {
        throw new Error("Malformed webhook Content-Length");
      }
      length = Number(contentLengths[0]);
      if (!Number.isSafeInteger(length)) throw new Error("Malformed webhook Content-Length");
    }
    return { status, bodyStart: start, length: status === 204 || status === 304 ? 0 : length };
  }
}

/**
 * Send an HTTPS request to one of the DNS addresses that was already validated.
 * The TCP destination never re-resolves, while TLS SNI/certificate checks still use
 * the original hostname. Redirects are returned as ordinary 3xx responses.
 */
export async function phase2PinnedWebhookRequest(
  destinationUrl: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
  validatedAddresses?: string[],
  connector: Phase2PinnedConnector = phase2DefaultPinnedConnector,
): Promise<{ status: number; ok: boolean; text: () => Promise<string> }> {
  const url = new URL(destinationUrl);
  const timeoutMs = Math.min(Math.max(init.timeoutMs ?? 10_000, 100), 120_000);
  const deadline = Date.now() + timeoutMs;
  let addresses = validatedAddresses;
  if (!addresses?.length) {
    const validation = await phase2BeforeDeadline(
      validatePhase2WebhookDestination(destinationUrl),
      deadline,
    );
    if (!validation.valid || !validation.addresses?.length) {
      throw new TypeError(`Unsafe webhook destination: ${validation.reason ?? "rejected"}`);
    }
    addresses = validation.addresses;
  }
  if (addresses.some((address) => !phase2PublicIp(address))) {
    throw new TypeError("Unsafe webhook destination: non_public_address");
  }

  const address = addresses[crypto.getRandomValues(new Uint32Array(1))[0] % addresses.length];
  let connection: Phase2PinnedConnection | null = null;
  try {
    connection = await phase2BeforeDeadline(connector(address, url.hostname, 443), deadline);

    const body = init.body ?? "";
    const bodyBytes = new TextEncoder().encode(body);
    const headers = new Headers(init.headers ?? {});
    headers.set("Host", url.hostname);
    headers.set("Connection", "close");
    headers.set("Content-Length", String(bodyBytes.length));
    for (const [name, value] of headers) {
      if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) throw new TypeError("Unsafe webhook header");
    }
    const target = `${url.pathname || "/"}${url.search}`;
    const head = `${init.method ?? "POST"} ${target} HTTP/1.1\r\n${
      Array.from(headers, ([name, value]) => `${name}: ${value}`).join("\r\n")
    }\r\n\r\n`;
    await phase2WriteAll(connection, new TextEncoder().encode(head), deadline);
    if (bodyBytes.length) await phase2WriteAll(connection, bodyBytes, deadline);

    const maxResponseBytes = 64 * 1024 + 32 * 1024;
    const bytes = new Uint8Array(maxResponseBytes);
    let total = 0;
    const buffer = new Uint8Array(8192);
    let responseHead: ReturnType<typeof phase2ResponseHead> = null;
    while (total < maxResponseBytes) {
      const count = await phase2BeforeDeadline(connection.read(buffer.subarray(0, maxResponseBytes - total)), deadline);
      if (count === null) break;
      if (count === 0) throw new Error("Webhook connection closed");
      bytes.set(buffer.subarray(0, count), total);
      total += count;
      responseHead ??= phase2ResponseHead(bytes.subarray(0, total));
      if (responseHead && responseHead.length !== null && total - responseHead.bodyStart >= responseHead.length) break;
    }
    if (!responseHead) throw new Error("Malformed webhook HTTP response");
    const { status, bodyStart, length } = responseHead;
    // Hitting the memory cap is not proof of completion. An acknowledgement with a declared
    // body must be complete even when the response buffer filled exactly to its boundary.
    if (length !== null && total - bodyStart < length) {
      throw new Error("Incomplete webhook HTTP response");
    }
    const responseBody = new TextDecoder().decode(bytes.subarray(bodyStart, Math.min(total, bodyStart + Math.min(length ?? Infinity, 64 * 1024))));
    return { status, ok: status >= 200 && status < 300, text: async () => responseBody };
  } finally {
    try { connection?.close(); } catch { /* already closed */ }
  }
}
