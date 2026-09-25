import { corsHeadersForRequest, corsPreflightResponse } from "./cors.ts";
import { executePackageOperation, PackageIngestionError, parsePackageOperation, type PackageIngestionPorts, type PackageOperation } from "./learningPackageIngestion.ts";
import { MAX_PACKAGE_ZIP_BYTES } from "./learningPackageArchiveCore.ts";

export interface PackageHttpDependencies {
  authorize: (request: Request) => Promise<{ ports: PackageIngestionPorts;
    context: (versionId: string | null, packageId: string | null) => Promise<{ sourceRevision: string }> }>;
  mode: "upload" | "accept";
}
export async function boundedPackageBody(req: Pick<Request, "headers" | "body"> & { signal?: AbortSignal }, maximum: number): Promise<Uint8Array> {
  const length = req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new PackageIngestionError(413, "Package request exceeds its size limit.");
  if (!req.body) throw new PackageIngestionError(400, "A package request is required.");
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  req.signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (req.signal?.aborted) throw new PackageIngestionError(408, "Package request timed out.");
      const { value, done } = await reader.read();
      if (req.signal?.aborted) throw new PackageIngestionError(408, "Package request timed out.");
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new PackageIngestionError(413, "Package request exceeds its size limit."); }
      chunks.push(value);
    }
  } finally { req.signal?.removeEventListener("abort", abort); reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function json(req: Request, value: unknown, status: number) {
  return new Response(JSON.stringify(value), { status, headers: { ...corsHeadersForRequest(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
export function createLearningPackageHttpHandler(deps: PackageHttpDependencies) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return corsPreflightResponse(req);
    if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
    try {
      // Authenticate before allocating the request body.
      const caller = await deps.authorize(req);
      let operation: PackageOperation; let file: Blob | null = null;
      if (deps.mode === "upload") {
        if (!req.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new PackageIngestionError(415, "Choose a ZIP file to upload.");
        const bytes = await boundedPackageBody(req, MAX_PACKAGE_ZIP_BYTES + 65536);
        const form = await new Response(bytes as BodyInit, { headers: { "Content-Type": req.headers.get("content-type")! } }).formData();
        if ([...form.keys()].length !== 2 || form.getAll("request").length !== 1 || form.getAll("file").length !== 1
          || typeof form.get("request") !== "string" || !(form.get("file") instanceof Blob)) throw new PackageIngestionError(400, "Choose one package file.");
        operation = parsePackageOperation(JSON.parse(String(form.get("request"))));
        if (operation.operation !== "upload") throw new PackageIngestionError(400, "Invalid upload operation.");
        file = form.get("file") as Blob;
      } else {
        if (req.headers.get("content-type")?.split(";", 1)[0] !== "application/json") throw new PackageIngestionError(415, "JSON is required.");
        const body = JSON.parse(new TextDecoder().decode(await boundedPackageBody(req, 8192)));
        // Existing native UI gets a starting snapshot; finalization rechecks it after I/O.
        if (body && typeof body === "object" && !Array.isArray(body) && !Object.hasOwn(body, "operation")) {
          if (Object.keys(body).some(key => !["package_id", "entry_point", "reason", "request_id", "source_revision"].includes(key))
            || typeof body.package_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.package_id)) throw new PackageIngestionError(400, "Invalid package request.");
          const context = await caller.context(null, body.package_id);
          operation = parsePackageOperation({ operation: "accept", requestId: body.request_id ?? crypto.randomUUID(), packageId: body.package_id,
            sourceRevision: body.source_revision ?? context.sourceRevision, entryPoint: body.entry_point ?? null, reason: body.reason });
        } else operation = parsePackageOperation(body);
        if (operation.operation !== "accept") throw new PackageIngestionError(400, "Invalid acceptance operation.");
      }
      const result = await executePackageOperation(operation, file, caller.ports);
      return json(req, { success: true, ...result, contentSha256: result.runtimeSha256 ?? result.sourceSha256 }, 200);
    } catch (error) {
      if (error instanceof PackageIngestionError) return json(req, { error: error.message }, error.status);
      if (error instanceof SyntaxError || error instanceof TypeError) return json(req, { error: "Invalid package request." }, 400);
      return json(req, { error: "The package operation could not be completed." }, 502);
    }
  };
}
