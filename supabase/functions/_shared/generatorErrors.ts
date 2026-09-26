const MESSAGES = {
  read: "Unable to load the information needed for this document. Try again or contact support.",
  save: "Unable to save the generated document. Try again or contact support.",
  link: "Unable to create the download link. Try again or contact support.",
  audit: "Unable to record this generation. The download is withheld until it can be audited.",
  provider: "The generation service could not complete this request. Try again or contact support.",
  course: "Unable to save the generated course or training plan. Try again or contact support.",
} as const;

/** Never send database, Storage or provider error text to a browser or a saved job summary. */
export function publicGeneratorError(operation: keyof typeof MESSAGES, raw: unknown): string {
  const reference = crypto.randomUUID();
  const code = raw && typeof raw === "object" && "code" in raw ? raw.code : undefined;
  // Error messages/details can contain resident data, SQL, URLs or credentials. Log only
  // a closed operation, a generated reference and a validated SQLSTATE for diagnosis.
  console.error("generation_failed", {
    operation,
    reference,
    code: typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : undefined,
  });
  return `${MESSAGES[operation]} (reference ${reference})`;
}
