type StorageFailure = { message: string; status?: number; statusCode?: string | number; code?: string; error?: string };

type GeneratedDocumentStorage = {
  from(bucket: string): {
    upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: StorageFailure | null }>;
    remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
  };
};

function uploadMayHaveCommitted(error: unknown): boolean {
  if (error === null || typeof error !== "object") return true;
  const failure = error as StorageFailure;
  // Supabase supports both current and legacy Storage error formats.
  // https://supabase.com/docs/guides/storage/debugging/error-codes
  if (["ResourceAlreadyExists", "KeyAlreadyExists", "already_exists", "Duplicate"].includes(failure.code ?? failure.error ?? "")) return false;
  const status = Number(failure.statusCode ?? failure.status);
  return !(status >= 400 && status < 500 && status !== 408);
}

async function discardUnreferencedAttempt(storage: GeneratedDocumentStorage, path: string): Promise<void> {
  try {
    const { error } = await storage.from("resident-documents").remove([path]);
    if (error) console.warn("Generated resident document attempt cleanup failed");
  } catch {
    console.warn("Generated resident document attempt cleanup failed");
  }
}

/** Metadata owns idempotency; every attempt owns a fresh, non-overwriting object. */
export async function uploadGeneratedResidentDocument(
  storage: GeneratedDocumentStorage,
  organizationId: string,
  facilityId: string,
  fileStem: string,
  bytes: Uint8Array,
) {
  const path = `${organizationId}/${facilityId}/${fileStem}-${crypto.randomUUID()}.pdf`;
  try {
    const { error } = await storage.from("resident-documents").upload(path, bytes, { contentType: "application/pdf", upsert: false });
    // The response can fail after Storage accepted the bytes. No metadata insert has
    // been attempted yet, so this newly allocated attempt can safely be discarded.
    // A definite collision does not establish ownership of the existing object.
    if (error && uploadMayHaveCommitted(error)) await discardUnreferencedAttempt(storage, path);
    return { path, error };
  } catch (error) {
    if (uploadMayHaveCommitted(error)) await discardUnreferencedAttempt(storage, path);
    throw error;
  }
}

/** Only a definite unique-constraint rejection proves this attempt did not commit. */
export async function discardConflictingGeneratedDocument(
  storage: GeneratedDocumentStorage,
  path: string,
  error: { code?: string },
): Promise<void> {
  if (error.code !== "23505") return;
  try {
    const { error: cleanupError } = await storage.from("resident-documents").remove([path]);
    if (cleanupError) console.warn("Generated resident document duplicate cleanup failed");
  } catch {
    console.warn("Generated resident document duplicate cleanup failed");
  }
}
