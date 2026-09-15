type GeneratedDocumentStorage = {
  from(bucket: string): {
    upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: { message: string } | null }>;
    remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
  };
};

/** Metadata owns idempotency; every attempt owns a fresh, non-overwriting object. */
export async function uploadGeneratedResidentDocument(
  storage: GeneratedDocumentStorage,
  organizationId: string,
  facilityId: string,
  fileStem: string,
  bytes: Uint8Array,
) {
  const path = `${organizationId}/${facilityId}/${fileStem}-${crypto.randomUUID()}.pdf`;
  const { error } = await storage.from("resident-documents").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  return { path, error };
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
