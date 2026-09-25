import type { Page, Request } from "@playwright/test";

interface QueryResponse {
  sequence: number;
  method: string;
  url: string;
  body: string | null;
  status: number;
  json: () => Promise<unknown>;
}

function diagnostic(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:password|token|secret|api[_ -]?key)\s*[:=]\s*\S+/gi, "[redacted credential]")
    .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}\b/g, "[redacted token]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted key]")
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z0-9+/_=-]{48,}/g, "[long value]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Tracks failures by complete request identity; diagnostic output never includes request data. */
export class QueryFailureRecorder {
  private readonly failures = new Map<string, { sequence: number; summary: string }>();
  private readonly successes = new Map<string, number>();
  private readonly pending = new Set<Promise<void>>();

  record(response: QueryResponse): void {
    const key = JSON.stringify([response.method, response.url, response.body]);
    if (response.status >= 200 && response.status < 300) {
      this.successes.set(key, Math.max(response.sequence, this.successes.get(key) ?? 0));
      const failure = this.failures.get(key);
      if (failure && failure.sequence <= response.sequence) this.failures.delete(key);
      return;
    }
    if (response.status < 400 || (this.successes.get(key) ?? 0) >= response.sequence) return;
    if ((this.failures.get(key)?.sequence ?? 0) > response.sequence) return;

    const entry = {
      sequence: response.sequence,
      summary: `${response.status} ${response.method} ${diagnostic(new URL(response.url).pathname, 180)}`,
    };
    this.failures.set(key, entry);
    // Insert the failure synchronously. A later success deletes this exact entry while a slow
    // JSON body is being read; completing that read must never put the old failure back.
    const read = Promise.resolve().then(() => response.json()).then(body => {
      if (!body || typeof body !== "object" || Array.isArray(body)) return;
      const detail = body as Record<string, unknown>;
      const code = diagnostic(detail.code, 40);
      const message = diagnostic(detail.message, 220);
      entry.summary += `${code ? ` [${code}]` : ""}${message ? `: ${message}` : ""}`;
    }).catch(() => {
      // Gateway HTML, empty responses and canceled bodies still retain HTTP status + path.
    });
    this.pending.add(read);
    void read.then(() => this.pending.delete(read));
  }

  async unresolved(): Promise<string[]> {
    // Response callbacks may have fired before their body streams have finished. Include all
    // diagnostic reads scheduled during this drain, not just a snapshot of the first batch.
    while (this.pending.size) await Promise.all(this.pending);
    return [...this.failures.values()].map(entry => entry.summary);
  }

  clear(): void {
    this.failures.clear();
  }
}

export function monitorQueryFailures(page: Page, supabaseUrl: string): QueryFailureRecorder {
  const recorder = new QueryFailureRecorder();
  const origin = new URL(supabaseUrl).origin;
  let sequence = 0;
  const requestSequences = new WeakMap<Request, number>();
  const isDataRequest = (url: URL) => url.origin === origin && url.pathname.startsWith("/rest/v1/");
  page.on("request", request => {
    if (isDataRequest(new URL(request.url()))) requestSequences.set(request, ++sequence);
  });
  page.on("response", response => {
    if (!isDataRequest(new URL(response.url()))) return;
    const request = response.request();
    recorder.record({
      sequence: requestSequences.get(request) ?? ++sequence,
      method: request.method(), url: request.url(), body: request.postData(),
      status: response.status(), json: () => response.json(),
    });
  });
  return recorder;
}
