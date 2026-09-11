import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { zipSync } from "npm:fflate@0.8.3";
import { readPackageArchive } from "./learningPackageArchive.ts";
import { PackageIngestionError, packageRpcError } from "./learningPackageIngestion.ts";
import type { PackageHttpDependencies } from "./learningPackageHttp.ts";

export function nativePackageDependencies(mode: "upload" | "accept", getEnv = (key: string) => Deno.env.get(key)): PackageHttpDependencies {
  return { mode, async authorize(request) {
    const authorization = request.headers.get("authorization");
    if (!authorization || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization) || authorization.length > 8192) throw new PackageIngestionError(401, "Sign in to change course packages.");
    const url = getEnv("SUPABASE_URL"); const anon = getEnv("SUPABASE_ANON_KEY"); const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) throw new PackageIngestionError(503, "Package ingestion is not configured.");
    const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000), ...(init?.signal ? [init.signal] : [])]) });
    const caller = createClient(url, anon, { global: { fetch: boundedFetch, headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const admin = createClient(url, service, { global: { fetch: boundedFetch }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await caller.auth.getUser();
    if (error || !data.user) throw new PackageIngestionError(401, "Sign in again before changing course packages.");
    return {
      async context(versionId, packageId) {
        const result = await caller.rpc("get_native_learning_package_context", { p_version_id: versionId, p_package_id: packageId });
        packageRpcError(result.error); return result.data;
      },
      ports: {
        codec: { readArchive: readPackageArchive, zipFiles: files => zipSync(files, { level: 6, mtime: new Date(2000, 0, 1, 0, 0, 0) }) },
        async prepare(input) { const result = await caller.rpc("prepare_native_learning_package_operation", { p_request: input }); packageRpcError(result.error); return result.data; },
        async finish(operationId) { const result = await caller.rpc("finish_native_learning_package_operation", { p_operation_id: operationId }); packageRpcError(result.error); return result.data; },
        async record(proof) { const result = await admin.rpc("record_learning_package_artifact", proof); packageRpcError(result.error); },
        async download(bucket, path) { const result = await admin.storage.from(bucket).download(path); if (result.error) throw new PackageIngestionError(502, "Package source could not be read."); return result.data; },
        async upload(bucket, path, bytes) {
          const result = await admin.storage.from(bucket).upload(path, bytes, { contentType: "application/zip", upsert: false });
          if (!result.error) return "created";
          const error = result.error as { statusCode?: string | number; error?: string; message?: string };
          if (String(error.statusCode) === "409" || error.error === "Duplicate" || error.message === "The resource already exists") return "exists";
          throw new PackageIngestionError(502, "Immutable package bytes could not be stored.");
        },
      },
    };
  } };
}
