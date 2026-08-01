import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  normalizeRuntimeCommitState,
  runtimeCommitToJson,
  type LaunchSession,
  type RuntimeCommitState,
  type RuntimeStandard,
} from "@/lib/learningRuntime";

function rpc() {
  return supabase as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
}

export function asLaunchSession(data: unknown): LaunchSession {
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    sessionId: String(row.sessionId ?? ""),
    packageId: String(row.packageId ?? ""),
    assignmentId: String(row.assignmentId ?? ""),
    employeeId: String(row.employeeId ?? ""),
    standard: String(row.standard ?? "scorm_1_2") as RuntimeStandard,
    entryPoint: row.entryPoint == null ? null : String(row.entryPoint),
    storageBucket: String(row.storageBucket ?? "learning-packages"),
    storagePath: String(row.storagePath ?? ""),
    registrationKey: String(row.registrationKey ?? ""),
    launchNonce: row.launchNonce == null ? undefined : String(row.launchNonce),
    expiresAt: String(row.expiresAt ?? ""),
    // A reused session keeps its existing commits, and commit_learning_runtime_state requires
    // max(sequence_number) + 1. Fall back to 1 only when the RPC predates 20260731190000.
    nextSequenceNumber: Number.isFinite(Number(row.nextSequenceNumber))
      ? Math.max(1, Number(row.nextSequenceNumber))
      : 1,
    reused: Boolean(row.reused),
  };
}

/** Accepted packages for a course version (if any). */
export function useAcceptedLearningPackages(courseVersionId: string | undefined) {
  return useQuery({
    queryKey: ["learning_packages", "accepted", courseVersionId],
    enabled: Boolean(courseVersionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learning_packages")
        .select("id, standard_type, entry_point, storage_bucket, storage_path, validation_status, course_version_id")
        .eq("course_version_id", courseVersionId!)
        .eq("validation_status", "accepted")
        .order("validated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useStartLearningRuntimeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ assignmentId, packageId }: { assignmentId: string; packageId?: string }) => {
      const { data, error } = await rpc().rpc("start_learning_runtime_session", {
        p_assignment_id: assignmentId,
        p_package_id: packageId ?? null,
      });
      if (error) throw new Error(error.message);
      const launch = asLaunchSession(data);
      if (!launch.sessionId) throw new Error("Runtime launch returned no session");
      return launch;
    },
    onSuccess: (launch) => {
      void queryClient.invalidateQueries({ queryKey: ["learning_runtime_sessions", launch.assignmentId] });
    },
  });
}

export function useCommitLearningRuntimeState() {
  return useMutation({
    mutationFn: async ({
      sessionId,
      sequenceNumber,
      idempotencyKey,
      state,
    }: {
      sessionId: string;
      sequenceNumber: number;
      idempotencyKey: string;
      state: RuntimeCommitState | Record<string, unknown>;
    }) => {
      const normalized = "completionStatus" in state || "progress" in state
        ? normalizeRuntimeCommitState(state as Record<string, unknown>)
        : (state as RuntimeCommitState);
      const { data, error } = await rpc().rpc("commit_learning_runtime_state", {
        p_runtime_session_id: sessionId,
        p_idempotency_key: idempotencyKey,
        p_sequence_number: sequenceNumber,
        p_state: runtimeCommitToJson(normalized),
      });
      if (error) throw new Error(error.message);
      return { commitId: data as string, state: normalized };
    },
  });
}

export function useIngestXapiStatement() {
  return useMutation({
    mutationFn: async (args: {
      statementId: string;
      sessionId: string;
      employeeId: string;
      verbIri: string;
      objectIri: string;
      result?: Record<string, unknown>;
      context?: Record<string, unknown>;
      occurredAt?: string;
    }) => {
      const { data, error } = await rpc().rpc("ingest_xapi_statement", {
        p_statement_id: args.statementId,
        p_runtime_session_id: args.sessionId,
        p_actor_employee_id: args.employeeId,
        p_verb_iri: args.verbIri,
        p_object_iri: args.objectIri,
        p_result: args.result ?? {},
        p_context: args.context ?? {},
        p_occurred_at: args.occurredAt ?? new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
  });
}

/** Best-effort signed URL for the package object (zip or entry asset). */
export async function createPackageContentSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export function useAdminLearningPackages(courseVersionId?: string | null) {
  return useQuery({
    queryKey: ["learning_packages", "admin", courseVersionId ?? "all"],
    queryFn: async () => {
      const { data, error } = await rpc().rpc("list_learning_packages_admin", {
        p_course_version_id: courseVersionId ?? null,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{
        id: string;
        course_version_id: string;
        standard_type: string;
        validation_status: string;
        entry_point: string | null;
        storage_path: string;
        content_sha256: string;
        created_at: string;
      }>;
    },
    staleTime: 15_000,
  });
}

export function useRegisterLearningPackage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      courseVersionId: string;
      standardType?: string;
      storagePath: string;
      contentSha256: string;
      compressedBytes: number;
      entryPoint?: string;
    }) => {
      const { data, error } = await rpc().rpc("register_learning_package", {
        p_course_version_id: input.courseVersionId,
        p_standard_type: input.standardType ?? "scorm_1_2",
        p_storage_path: input.storagePath,
        p_content_sha256: input.contentSha256,
        p_compressed_bytes: input.compressedBytes,
        p_entry_point: input.entryPoint ?? "index.html",
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["learning_packages"] });
    },
  });
}

export function useAcceptLearningPackage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { packageId: string; entryPoint?: string; reason: string }) => {
      // Routes through the accept-learning-package edge function so bridge injection
      // happens server-side (clients cannot skip it). The function downloads the zip,
      // injects carebase/learning-runtime-bridge.js, re-uploads, and calls the RPC.
      const { data, error } = await supabase.functions.invoke("accept-learning-package", {
        body: {
          package_id: input.packageId,
          entry_point: input.entryPoint ?? null,
          reason: input.reason,
        },
      });
      if (error) throw new Error(error.message);
      if (data && typeof data === "object" && "error" in data) {
        throw new Error(String((data as Record<string, unknown>).error));
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["learning_packages"] });
    },
  });
}

export function useQuarantineLearningPackage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { packageId: string; reason: string }) => {
      const { error } = await rpc().rpc("quarantine_learning_package", {
        p_package_id: input.packageId,
        p_reason: input.reason,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["learning_packages"] });
    },
  });
}
