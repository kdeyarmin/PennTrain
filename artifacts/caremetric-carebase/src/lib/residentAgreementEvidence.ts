/** The database independently validates the date and resident ownership of the document. */
export function wetSignatureEvidenceError(signedAt?: string, signedDocumentId?: string, now = new Date()): string | null {
  if (!signedAt || !Number.isFinite(new Date(signedAt).getTime())) return "Enter the actual signing date and time shown by the signed evidence.";
  if (new Date(signedAt) > now) return "The actual signing date and time cannot be in the future.";
  if (!signedDocumentId || signedDocumentId === "none") return "Select the signed document from this resident's record.";
  return null;
}
