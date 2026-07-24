import { Zip, ZipDeflate, ZipPassThrough } from "npm:fflate@0.8.2";
import { crypto as stdCrypto } from "jsr:@std/crypto@1";

// Streaming-archive plumbing and pure decision logic for the organization export
// worker (process-organization-export-jobs). Everything with a testable decision
// lives here; the worker's index.ts only wires Supabase I/O to these pieces.

/** Per-object embedding cap. Objects larger than this stay referenced-only. */
export const MAX_EMBED_OBJECT_BYTES = 100 * 1024 * 1024;
/**
 * Total uncompressed bytes of binary documents embedded per run. The export
 * bucket caps archives at 1 GiB, so the budget keeps the archive (CSV tables +
 * stored-not-deflated binaries) safely under that limit.
 */
export const EMBED_TOTAL_BUDGET_BYTES = 700 * 1024 * 1024;

export type EmbedDecision = { embed: true } | { embed: false; skipReason: string };

/**
 * Decide whether a document object should be embedded into the archive.
 * Pure so the skip semantics are unit-testable. `objectBytes` is null when the
 * object's size is not yet known (no Content-Length); size-dependent rules are
 * then re-applied by the caller once the size is known.
 */
export function decideDocumentEmbedding(input: {
  referenceValid: boolean;
  referenceReason?: string;
  objectBytes: number | null;
  maxObjectBytes: number;
  remainingBudgetBytes: number;
  deadlineExceeded: boolean;
}): EmbedDecision {
  if (!input.referenceValid) {
    return { embed: false, skipReason: `invalid_reference:${input.referenceReason ?? "unknown"}` };
  }
  if (input.deadlineExceeded) return { embed: false, skipReason: "deadline_exceeded" };
  if (input.remainingBudgetBytes <= 0) return { embed: false, skipReason: "embed_budget_exhausted" };
  if (input.objectBytes !== null && input.objectBytes > input.maxObjectBytes) {
    return { embed: false, skipReason: "size_cap_exceeded" };
  }
  if (input.objectBytes !== null && input.objectBytes > input.remainingBudgetBytes) {
    return { embed: false, skipReason: "embed_budget_exhausted" };
  }
  return { embed: true };
}

/**
 * Public tables without an organization_id column that hold platform-operated
 * data rather than shared tenant-adjacent records: marketing/signup intake,
 * release + entitlement configuration, regulatory reference material mirrored
 * from state/federal sources, the federal exclusion-list mirror, cross-tenant
 * k-anonymized benchmarks, and lifecycle bookkeeping. They are listed in
 * exclusions.json under platformInternalTables (when present at run time) so
 * the archive still names them, but they are not customer data to hand over.
 */
export const PLATFORM_INTERNAL_TABLES: readonly string[] = [
  "benchmark_snapshots",
  "data_lifecycle_policies",
  "data_lifecycle_runs",
  "demo_requests",
  "dhs_citation_topics",
  "exclusion_list_entries",
  "exclusion_refresh_runs",
  "exclusion_source_snapshots",
  "exclusion_source_state",
  "feature_definitions",
  "help_articles",
  "integration_api_scope_definitions",
  "integration_schema_definitions",
  "newsletter_subscribers",
  "package_billing_prices",
  "package_entitlements",
  "packages",
  "permission_definitions",
  "platform_settings",
  "regulatory_change_proposals",
  "regulatory_rule_fixture_runs",
  "regulatory_rule_golden_fixtures",
  "regulatory_rule_pack_templates",
  "regulatory_rule_packs",
  "regulatory_rule_shadow_differences",
  "regulatory_rule_shadow_reconciliations",
  "regulatory_rule_versions",
  "regulatory_source_snapshots",
  "regulatory_update_sources",
  "regulatory_updates",
  "release_cohorts",
  "release_flags",
  "role_template_permissions",
  "savings_model_requests",
  "signup_attempts",
];

export interface ExportExclusions {
  /** Shared/global tables (no organization_id) the export cannot scope to one tenant. */
  sharedTables: string[];
  /** Platform-internal tables (documented allowlist) observed at run time. */
  platformInternalTables: string[];
  /** Tables without organization_id that ARE exported through a dedicated path. */
  exportedSeparately: string[];
}

/**
 * Partition the run-time information_schema scan of public tables WITHOUT an
 * organization_id column into the honest scope declaration the archive ships as
 * exclusions.json. Pure so it is unit-testable.
 */
export function computeExportExclusions(input: {
  nonOrganizationTables: string[];
  platformInternalAllowlist?: readonly string[];
}): ExportExclusions {
  const allowlist = new Set(input.platformInternalAllowlist ?? PLATFORM_INTERNAL_TABLES);
  const seen = new Set<string>();
  const sharedTables: string[] = [];
  const platformInternalTables: string[] = [];
  const exportedSeparately: string[] = [];
  for (const table of [...input.nonOrganizationTables].sort()) {
    if (seen.has(table)) continue;
    seen.add(table);
    // organizations has no organization_id column but is written to the archive
    // as tables/organizations.csv by the worker's dedicated path.
    if (table === "organizations") exportedSeparately.push(table);
    else if (allowlist.has(table)) platformInternalTables.push(table);
    else sharedTables.push(table);
  }
  return { sharedTables, platformInternalTables, exportedSeparately };
}

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Consume `source`, forwarding every chunk to `forward` (which must apply its
 * own backpressure by resolving only when the chunk has been accepted) while
 * computing a SHA-256 and byte count over the exact bytes seen. Used both for
 * per-document hashes (forward = zip entry push) and for the archive itself
 * (forward = storage upload writer), so peak memory stays at chunk granularity.
 */
export async function hashWhileForwarding(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  forward: (chunk: Uint8Array) => Promise<void>,
): Promise<{ sha256: string; byteSize: number }> {
  let byteSize = 0;
  const digest = await stdCrypto.subtle.digest(
    "SHA-256",
    (async function* (): AsyncGenerator<Uint8Array<ArrayBuffer>> {
      for await (const chunk of source) {
        byteSize += chunk.length;
        await forward(chunk);
        // Chunks originate from fetch bodies / fresh allocations, never from a
        // SharedArrayBuffer; the assertion only reconciles lib.dom's generic
        // Uint8Array<ArrayBufferLike> with std/crypto's BufferSource input.
        yield chunk as Uint8Array<ArrayBuffer>;
      }
    })(),
  );
  return { sha256: toHex(digest), byteSize };
}

export interface ZipEntrySink {
  push(chunk: Uint8Array): Promise<void>;
  finish(): Promise<void>;
}

const PUSH_SLICE_BYTES = 64 * 1024;

/**
 * Incremental ZIP writer over fflate's streaming Zip. Output is exposed as a
 * backpressured ReadableStream: producers (addFile/entry pushes) await drain
 * whenever the consumer falls behind, so peak memory is bounded by the queue's
 * high-water mark times chunk size -- never by the archive size (which is why
 * this replaced zipSync for exports that now embed binary documents).
 *
 * Entries must be written one at a time, fully, in order (fflate would buffer
 * out-of-order data in memory otherwise); `open` enforces that.
 */
export class StreamingZipWriter {
  readonly readable: ReadableStream<Uint8Array>;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private readonly zip: Zip;
  private drainWaiters: Array<() => void> = [];
  private failure: Error | null = null;
  private openEntry = false;

  constructor() {
    this.readable = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          this.controller = controller;
        },
        pull: () => {
          const waiters = this.drainWaiters.splice(0);
          for (const resolve of waiters) resolve();
        },
        cancel: (reason) => {
          this.fail(reason instanceof Error ? reason : new Error(String(reason ?? "archive consumer cancelled")));
        },
      },
      new CountQueuingStrategy({ highWaterMark: 8 }),
    );
    this.zip = new Zip((error, chunk, final) => {
      if (this.failure) return;
      if (error) {
        this.fail(error);
        return;
      }
      if (chunk && chunk.length > 0) this.controller.enqueue(chunk);
      if (final) this.controller.close();
    });
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    try {
      this.controller.error(error);
    } catch {
      // The stream may already be closed or errored; the recorded failure still
      // makes every subsequent producer call throw.
    }
    for (const resolve of this.drainWaiters.splice(0)) resolve();
  }

  private waitForDrain(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if ((this.controller.desiredSize ?? 1) > 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  /**
   * Open a streaming entry. `compress: false` stores bytes as-is (used for
   * binary documents, which are typically already-compressed formats).
   */
  open(name: string, options: { compress: boolean }): ZipEntrySink {
    if (this.failure) throw this.failure;
    if (this.openEntry) throw new Error("A zip entry is already open; finish it before opening another");
    this.openEntry = true;
    const file = options.compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    this.zip.add(file);
    return {
      push: async (chunk: Uint8Array) => {
        if (this.failure) throw this.failure;
        if (chunk.length > 0) file.push(chunk);
        await this.waitForDrain();
        if (this.failure) throw this.failure;
      },
      finish: async () => {
        if (this.failure) throw this.failure;
        file.push(new Uint8Array(0), true);
        this.openEntry = false;
        await this.waitForDrain();
        if (this.failure) throw this.failure;
      },
    };
  }

  /** Write a whole in-memory file, sliced so backpressure stays fine-grained. */
  async addFile(name: string, data: Uint8Array, options: { compress: boolean } = { compress: true }): Promise<void> {
    const entry = this.open(name, options);
    for (let offset = 0; offset < data.length; offset += PUSH_SLICE_BYTES) {
      await entry.push(data.subarray(offset, Math.min(data.length, offset + PUSH_SLICE_BYTES)));
    }
    await entry.finish();
  }

  /** Signal that every entry has been written; the stream then closes. */
  end(): void {
    if (this.failure) throw this.failure;
    if (this.openEntry) throw new Error("Cannot end the archive while an entry is still open");
    this.zip.end();
  }

  /** Abort the archive (build failure): errors the readable so consumers stop. */
  abort(error: Error): void {
    this.fail(error);
  }
}
