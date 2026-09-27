import { hasDefinitivePostgresWriteRejection } from "@/lib/postgresWriteOutcome";

/** Recover a committed link, or retain uploaded bytes until its outcome is certain. */
export async function recoverUploadedWrite<T>({ error, read, remove }: {
  error: unknown;
  read: () => PromiseLike<{ data: T | null; error: unknown }>;
  remove: () => PromiseLike<{ error: { message: string } | null }>;
}): Promise<T> {
  const unknown = new Error("The document save could not be confirmed. The uploaded file was retained; refresh the document list before retrying.");
  let saved: T | null;
  try {
    const result = await read();
    if (result.error) throw result.error;
    saved = result.data;
  } catch { throw unknown; }
  if (saved) return saved;
  // An empty read does not exclude a still-running write after a lost response.
  if (!hasDefinitivePostgresWriteRejection(error)) throw unknown;
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "Document save failed";
  try {
    const result = await remove();
    if (result.error) throw new Error(result.error.message);
  } catch (cleanupError) {
    throw new Error(`${message} (also failed to remove uploaded file: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)})`);
  }
  throw error;
}
